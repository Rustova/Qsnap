import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";
import jsPDF from 'jspdf';

// --- GITHUB & DATA PERSISTENCE CONFIG ---
// IMPORTANT: Replace with your GitHub username and repository details.
const GITHUB_OWNER = 'Rustova'; 
const GITHUB_REPO = 'Q'; 
const DATA_FILE_PATH = 'data.json';
const PAT_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz-AFYjxhI7KH_IfXAfm1dr5C5XM3D1YKw8AkyljTvDS-dPbKDnYPYMlWnloQTvifDzdw/exec';

// --- GITHUB API HELPERS ---
const getGithubFile = async (token: string) => {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${DATA_FILE_PATH}`;
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });
    if (response.status === 404) {
      return null; // File doesn't exist, which is a valid state
    }
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching from GitHub:', error);
    throw error;
  }
};

const saveGithubFile = async (token: string, content: string, sha: string | null) => {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${DATA_FILE_PATH}`;
  const body = JSON.stringify({
    message: `[Qsnap] Update data - ${new Date().toISOString()}`,
    content: content,
    sha: sha,
  });

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: body,
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`GitHub API error: ${response.statusText} - ${errorData.message}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error saving to GitHub:', error);
    throw error;
  }
};


// --- TYPE DEFINITIONS ---
interface MCQ {
  id: string;
  question: string;
  options: string[];
  correctAnswer?: number;
}

interface Lecture {
  id: string;
  name: string;
  questions: MCQ[];
}

interface Subject {
  id: string;
  name: string;
  lectures: Lecture[];
}

interface ExtractionResult {
  imageUrl: string;
  questions: MCQ[];
  error?: string;
}

type View = 'home' | 'add' | 'library';


// --- HOOKS ---
function useOutsideAlerter(ref: React.RefObject<HTMLElement>, callback: () => void) {
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        callback();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [ref, callback]);
}


// --- CUSTOM COMPONENTS ---

// Custom Select Props
interface CustomSelectProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
}

const CustomSelect: React.FC<CustomSelectProps> = ({ options, value, onChange, placeholder, disabled }) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find(option => option.value === value);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  useOutsideAlerter(selectRef, () => setIsOpen(false));

  return (
    <div className="custom-select" ref={selectRef}>
      <button 
        className="select-button" 
        onClick={() => setIsOpen(!isOpen)} 
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span>{selectedOption?.label || placeholder}</span>
        <span className={`chevron ${isOpen ? 'open' : ''}`} />
      </button>
      {isOpen && (
        <ul className="select-options" role="listbox">
          {options.length > 0 ? options.map(option => (
            <li 
              key={option.value} 
              className={`select-option ${value === option.value ? 'selected' : ''}`}
              onClick={() => handleSelect(option.value)}
              role="option"
              aria-selected={value === option.value}
            >
              {option.label}
              {value === option.value && <span className="checkmark">✓</span>}
            </li>
          )) : (
             <li className="select-option-none">No options available</li>
          )}
        </ul>
      )}
    </div>
  );
};

// Question Card Props
interface QuestionCardProps {
  question: MCQ;
  onCopy: (question: MCQ) => void;
  copiedId: string | null;
  isStaged?: boolean;
  onSelectAnswer?: (optionIndex: number) => void;
  onStartEdit?: (question: MCQ) => void;
  onSaveEdit?: () => void;
  onCancelEdit?: () => void;
  editingQuestionId?: string | null;
  editedContent?: MCQ | null;
  onEditInputChange?: (field: 'question' | 'option', value: string, optionIndex?: number) => void;
  onEditCorrectAnswerChange?: (optionIndex: number) => void;
  onDelete?: () => void;
}

const QuestionCard: React.FC<QuestionCardProps> = ({
  question, onCopy, copiedId, isStaged = false, onSelectAnswer,
  onStartEdit, onSaveEdit, onCancelEdit, editingQuestionId, editedContent,
  onEditInputChange, onEditCorrectAnswerChange, onDelete
}) => {
  const isEditing = editingQuestionId === question.id;

  if (isEditing && editedContent && onEditInputChange && onEditCorrectAnswerChange && onCancelEdit && onSaveEdit) {
    return (
      <div className="question-card editing-view">
        <textarea
          className="question-edit-input"
          value={editedContent.question}
          onChange={(e) => onEditInputChange('question', e.target.value)}
          aria-label="Edit question text"
          rows={4}
        />
        <ul className="options-list">
          {editedContent.options.map((opt, i) => (
            <li key={i} className="option-item">
              <input
                type="radio"
                id={`edit-opt-${editedContent.id}-${i}`}
                name={`edit-correct-answer-${editedContent.id}`}
                checked={editedContent.correctAnswer === i}
                onChange={() => onEditCorrectAnswerChange(i)}
              />
              <input
                type="text"
                className="option-edit-input"
                value={opt}
                onChange={(e) => onEditInputChange('option', e.target.value, i)}
                aria-label={`Edit option ${i + 1}`}
              />
            </li>
          ))}
        </ul>
        <div className="edit-actions">
          <button className="btn-secondary cancel-button" onClick={onCancelEdit}>
            <i className="fa-regular fa-circle-xmark"></i> Cancel
          </button>
          <button className="save-button" onClick={onSaveEdit}>
            <i className="fa-solid fa-check"></i> Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="question-card">
      <div className="card-actions">
        {!isStaged && onStartEdit && (
          <button className="icon-button" onClick={() => onStartEdit(question)} title="Edit question">
            <i className="fa-solid fa-pencil"></i>
          </button>
        )}
        {!isStaged && onDelete && (
            <button className="icon-button delete-question-button" onClick={onDelete} title="Delete question">
                <i className="fa-solid fa-trash"></i>
            </button>
        )}
        <button className="icon-button copy-button" onClick={() => onCopy(question)} title="Copy question">
          {copiedId === question.id ? 'Copied!' : <i className="fa-solid fa-copy"></i>}
        </button>
      </div>
      <p className="question-text">{question.question}</p>
      <ul className="options-list">
        {question.options.map((opt, i) => (
          <li key={i} className={`option-item ${!isStaged && question.correctAnswer === i ? 'correct-answer' : ''}`}>
            {isStaged && onSelectAnswer ? (
              <>
                <input
                  type="radio"
                  id={`opt-${question.id}-${i}`}
                  name={`correct-answer-${question.id}`}
                  checked={question.correctAnswer === i}
                  onChange={() => onSelectAnswer(i)}
                />
                <label htmlFor={`opt-${question.id}-${i}`}>{opt}</label>
              </>
            ) : (
              <>
                {!isStaged && question.correctAnswer === i && <i className="fa-solid fa-check" style={{ color: 'var(--correct-answer-text)' }}></i>}
                <span>{opt}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};


// --- MAIN APP COMPONENT ---
const App = () => {
  // View & Core States
  const [currentView, setCurrentView] = useState<View>('home');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 1024);
  
  // 'Add' View States
  const [images, setImages] = useState<File[]>([]);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [extractionResults, setExtractionResults] = useState<ExtractionResult[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
  // Data & Library States
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newLectureNames, setNewLectureNames] = useState<{ [key: string]: string }>({});
  
  // Staging Area Selects
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');
  const [selectedLectureId, setSelectedLectureId] = useState<string>('');
  
  // Library Management States
  const [selectedManageSubjectId, setSelectedManageSubjectId] = useState<string>('');
  const [selectedManageLectureId, setSelectedManageLectureId] = useState<string>('');
  const [managedSubjectName, setManagedSubjectName] = useState('');
  const [isSubjectSettingsOpen, setIsSubjectSettingsOpen] = useState(false);
  const [isLectureSettingsOpen, setIsLectureSettingsOpen] = useState(false);
  const subjectSettingsRef = useRef<HTMLDivElement>(null);
  const lectureSettingsRef = useRef<HTMLDivElement>(null);

  
  // Editing States
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState<MCQ | null>(null);
  const [editingLecture, setEditingLecture] = useState<{id: string, name: string, subjectId: string} | null>(null);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  
  // Deletion Modal States
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{ type: 'subject' | 'lecture', id: string, subjectId?: string } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteConfirmationError, setDeleteConfirmationError] = useState('');

  // PDF Modal States
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);
  const [selectedPdfLectures, setSelectedPdfLectures] = useState<Set<string>>(new Set());
  const [pdfTextSize, setPdfTextSize] = useState<number>(12);
  const [pdfShowAnswers, setPdfShowAnswers] = useState(true);
  const [pdfSelectedSubjectIdForView, setPdfSelectedSubjectIdForView] = useState<string | null>(null);

  // Data Persistence States
  const [pat, setPat] = useState<string | null>(null);
  const [isDataLoading, setIsDataLoading] = useState<boolean>(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const isInitialLoad = useRef(true);
  const debounceTimer = useRef<number | null>(null);


  // --- Effects ---
  useOutsideAlerter(subjectSettingsRef, () => setIsSubjectSettingsOpen(false));
  useOutsideAlerter(lectureSettingsRef, () => setIsLectureSettingsOpen(false));

  // Effect for sidebar responsiveness
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 1024) {
        setIsSidebarOpen(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Effect for initial data loading
  useEffect(() => {
    const loadData = async () => {
        setIsDataLoading(true);
        setError(null);
        try {
            const patResponse = await fetch(PAT_SCRIPT_URL);
            if (!patResponse.ok) throw new Error('Failed to fetch authentication token.');
            const patData = await patResponse.json();
            if (!patData.pat) throw new Error('Authentication token is invalid.');
            const fetchedPat = patData.pat;
            setPat(fetchedPat);

            const fileData = await getGithubFile(fetchedPat);
            if (fileData && fileData.content) {
                const decodedContent = atob(fileData.content);
                const parsedData = JSON.parse(decodedContent);
                // Ensure the loaded data is an array before setting state to prevent crashes.
                if (Array.isArray(parsedData)) {
                    setSubjects(parsedData);
                } else {
                    console.error("Loaded data is not in the expected array format:", parsedData);
                    throw new Error("The data file on GitHub is not formatted correctly. Expected an array of subjects.");
                }
            } else {
                setSubjects([]);
            }
        } catch (err: any) {
            setError(`Failed to load library: ${err.message}. You can still use the app, but data will not be saved.`);
            console.error(err);
            setSubjects([]);
        } finally {
            setIsDataLoading(false);
            setTimeout(() => { isInitialLoad.current = false; }, 500);
        }
    };
    loadData();
  }, []);

  // Effect for saving data with debouncing
  useEffect(() => {
    if (isInitialLoad.current || !pat || isDataLoading) {
        return;
    }

    if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
    }

    setSaveStatus('saving');

    debounceTimer.current = window.setTimeout(async () => {
        try {
            const fileData = await getGithubFile(pat);
            const contentToSave = JSON.stringify(subjects, null, 2);
            const encodedContent = btoa(contentToSave);

            if (fileData && fileData.content.replace(/\s/g, '') === encodedContent.replace(/\s/g, '')) {
               setSaveStatus('saved');
               return;
            }

            await saveGithubFile(pat, encodedContent, fileData?.sha || null);
            setSaveStatus('saved');
        } catch (err) {
            console.error("Failed to save data:", err);
            setSaveStatus('error');
            setError('Failed to save data to GitHub. Please check your token and repository settings.');
        }
    }, 2000);

    return () => {
        if (debounceTimer.current) {
            clearTimeout(debounceTimer.current);
        }
    };
  }, [subjects, pat, isDataLoading]);

  // --- Handlers ---
  const handleNavigation = (view: View, subjectId?: string) => {
    setCurrentView(view);
    
    if (view === 'library') {
      if (subjectId) {
        setSelectedManageSubjectId(subjectId);
        setSelectedManageLectureId('');
      } else {
        if (!selectedManageSubjectId && subjects.length > 0) {
          setSelectedManageSubjectId(subjects[0].id);
        }
        setSelectedManageLectureId('');
      }
    }

    if (window.innerWidth <= 1024) {
      setIsSidebarOpen(false);
    }
  };

  const handleImagesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      setImages(files);
      // Clean up old object URLs to prevent memory leaks
      imageUrls.forEach(url => URL.revokeObjectURL(url));
      const urls = files.map(file => URL.createObjectURL(file));
      setImageUrls(urls);
      setExtractionResults([]);
      setError(null);
    }
  };

  const handleClearImages = () => {
    setImages([]);
    imageUrls.forEach(url => URL.revokeObjectURL(url));
    setImageUrls([]);
    setExtractionResults([]);
    setError(null);
  };

  const fileToGenerativePart = async (file: File) => {
    const base64EncodedDataPromise = new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.readAsDataURL(file);
    });
    return {
      inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
    };
  };

  const analyzeImages = async () => {
    if (images.length === 0) {
      setError("Please upload one or more images first.");
      return;
    }

    setIsLoading(true);
    setExtractionResults([]);
    setError(null);

    const ai = new GoogleGenAI({ apiKey: 'AIzaSyCg1IGbfaPMXHuvutYxyx0K0Xe1YvnhDsE' });
    
    const results = await Promise.all(
        images.map(async (file, index) => {
            try {
                const imagePart = await fileToGenerativePart(file);

                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: {
                        parts: [
                            imagePart,
                            { text: 'Extract all multiple-choice questions from this image. For each question, provide the question text and a list of all options. Important: Do not include the leading letters or numbers (e.g., "a.", "b)", "1.") in the text for each option. Respond in JSON format.' },
                        ],
                    },
                    config: {
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    question: {
                                        type: Type.STRING,
                                        description: 'The text of the multiple-choice question.',
                                    },
                                    options: {
                                        type: Type.ARRAY,
                                        items: { type: Type.STRING },
                                        description: 'A list of possible answers for the question. The text for each option should not include any leading markers like "a.", "b)", etc.',
                                    },
                                },
                                required: ['question', 'options'],
                            },
                        },
                    },
                });

                const parsedResponse = JSON.parse(response.text);
                if (Array.isArray(parsedResponse)) {
                    const questionsWithIds: MCQ[] = parsedResponse.map((q: Omit<MCQ, 'id'>, qIndex: number) => ({
                        ...q,
                        options: q.options.map(opt => opt.replace(/^\s*[a-zA-Z0-9]+[.)]\s*/, '').trim()),
                        id: `ext-${Date.now()}-${index}-${qIndex}`,
                        correctAnswer: undefined,
                    }));
                    return { imageUrl: imageUrls[index], questions: questionsWithIds };
                }
                // Handle cases where response is not an array (e.g., empty object)
                return { imageUrl: imageUrls[index], questions: [] };

            } catch (err) {
                console.error(`Error analyzing image ${index + 1}:`, err);
                return { imageUrl: imageUrls[index], questions: [], error: `Failed to extract questions from image ${index + 1}. Please try again.` };
            }
        })
    );
    
    setExtractionResults(results);
    setIsLoading(false);
  };

  const handleSelectStagedAnswer = (questionId: string, optionIndex: number) => {
    setExtractionResults(prevResults =>
      prevResults.map(result => ({
        ...result,
        questions: result.questions.map(q => (q.id === questionId ? { ...q, correctAnswer: optionIndex } : q))
      }))
    );
  };

  const handleAddQuestionsToLecture = () => {
    const allQuestions = extractionResults.flatMap(result => result.questions);
    if (!selectedSubjectId || !selectedLectureId || allQuestions.length === 0) {
      return;
    }
    setSubjects(prevSubjects =>
      prevSubjects.map(subject => {
        if (subject.id !== selectedSubjectId) return subject;
        return {
          ...subject,
          lectures: subject.lectures.map(lecture => {
            if (lecture.id !== selectedLectureId) return lecture;
            const newQuestions = allQuestions.map(q => ({ ...q, id: `lib-${Date.now()}-${Math.random()}` }));
            return { ...lecture, questions: [...lecture.questions, ...newQuestions] };
          }),
        };
      })
    );
    setExtractionResults([]);
    setImages([]);
    setImageUrls([]);
  };

  const handleAddSubject = (e: React.FormEvent) => {
    e.preventDefault();
    if (newSubjectName.trim()) {
      const newSubject: Subject = { id: `sub-${Date.now()}`, name: newSubjectName.trim(), lectures: [] };
      setSubjects(prev => [...prev, newSubject]);
      setNewSubjectName('');
    }
  };
  
  const handleUpdateSubject = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingSubject && managedSubjectName.trim()) {
        setSubjects(prev => prev.map(sub =>
            sub.id === editingSubject.id ? { ...sub, name: managedSubjectName.trim() } : sub
        ));
        setEditingSubject(null);
    }
  }

  const handleAddLecture = (e: React.FormEvent, subjectId: string) => {
    e.preventDefault();
    const lectureName = newLectureNames[subjectId]?.trim();
    if (lectureName) {
      const newLecture: Lecture = { id: `lec-${Date.now()}`, name: lectureName, questions: [] };
      setSubjects(prev =>
        prev.map(sub => (sub.id === subjectId ? { ...sub, lectures: [...sub.lectures, newLecture] } : sub))
      );
      setNewLectureNames(prev => ({ ...prev, [subjectId]: '' }));
    }
  };

  const handleInitiateDeleteSubject = (subjectId: string) => {
    setIsSubjectSettingsOpen(false);
    setItemToDelete({ type: 'subject', id: subjectId });
    setIsDeleteModalOpen(true);
  };

  const handleInitiateDeleteLecture = (subjectId: string, lectureId: string) => {
    setIsLectureSettingsOpen(false);
    setItemToDelete({ type: 'lecture', id: lectureId, subjectId: subjectId });
    setIsDeleteModalOpen(true);
  };

  const handleCancelDelete = () => {
    setIsDeleteModalOpen(false);
    setItemToDelete(null);
    setDeleteConfirmation('');
    setDeleteConfirmationError('');
  };

  const handleConfirmDelete = (e: React.FormEvent) => {
    e.preventDefault();
    if (deleteConfirmation.toLowerCase() !== 'delete') {
      setDeleteConfirmationError('Please type "delete" to confirm.');
      return;
    }

    if (itemToDelete) {
      if (itemToDelete.type === 'subject') {
        setSubjects(prev => prev.filter(sub => sub.id !== itemToDelete!.id));
        if (selectedManageSubjectId === itemToDelete.id) {
          setSelectedManageSubjectId('');
        }
      } else if (itemToDelete.type === 'lecture' && itemToDelete.subjectId) {
        const { subjectId, id: lectureId } = itemToDelete;
        setSubjects(prev =>
          prev.map(sub =>
            sub.id === subjectId
              ? { ...sub, lectures: sub.lectures.filter(lec => lec.id !== lectureId) }
              : sub
          )
        );
        if (selectedManageLectureId === lectureId) {
          setSelectedManageLectureId(''); 
        }
      }
    }
    
    handleCancelDelete(); // Reset and close modal
  };
  
  const handleDeleteQuestion = (subjectId: string, lectureId: string, questionId: string) => {
    setSubjects(prev => prev.map(sub => {
      if (sub.id !== subjectId) return sub;
      return {
        ...sub,
        lectures: sub.lectures.map(lec => {
          if (lec.id !== lectureId) return lec;
          return {
            ...lec,
            questions: lec.questions.filter(q => q.id !== questionId)
          };
        })
      };
    }));
  };
  
  const handleSaveLecture = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingLecture) {
      setSubjects(prev => prev.map(sub =>
        sub.id === editingLecture.subjectId
          ? {
              ...sub,
              lectures: sub.lectures.map(lec =>
                lec.id === editingLecture.id ? { ...lec, name: editingLecture.name } : lec
              )
            }
          : sub
      ));
      setEditingLecture(null);
    }
  };

  const handleStartEditQuestion = (question: MCQ) => {
    setEditingQuestionId(question.id);
    setEditedContent({ ...question });
  };
  
  const handleSaveEdit = () => {
    if (!editedContent || !editingQuestionId) return;
    setSubjects(prev => prev.map(sub => ({
      ...sub,
      lectures: sub.lectures.map(lec => ({
        ...lec,
        questions: lec.questions.map(q => q.id === editingQuestionId ? editedContent : q)
      }))
    })));
    setEditingQuestionId(null);
    setEditedContent(null);
  };
  
  const handleCancelEdit = () => {
    setEditingQuestionId(null);
    setEditedContent(null);
  };
  
  const handleEditInputChange = (field: 'question' | 'option', value: string, optionIndex?: number) => {
    if (!editedContent) return;
    if (field === 'question') {
      setEditedContent({ ...editedContent, question: value });
    } else if (field === 'option' && optionIndex !== undefined) {
      const newOptions = [...editedContent.options];
      newOptions[optionIndex] = value;
      setEditedContent({ ...editedContent, options: newOptions });
    }
  };
  
  const handleEditCorrectAnswerChange = (optionIndex: number) => {
    if (editedContent) {
      setEditedContent({ ...editedContent, correctAnswer: optionIndex });
    }
  };

  const handleCopy = (question: MCQ) => {
    const textToCopy = `Question: ${question.question}\n\nOptions:\n${question.options.map((opt, i) => `${i + 1}. ${opt}`).join('\n')}`;
    navigator.clipboard.writeText(textToCopy);
    setCopiedId(question.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const subjectOptions = useMemo(() =>
    subjects.map(sub => ({ value: sub.id, label: sub.name })),
    [subjects]
  );

  const lectureOptions = useMemo(() => {
    if (!selectedSubjectId) return [];
    const subject = subjects.find(sub => sub.id === selectedSubjectId);
    return subject ? subject.lectures.map(lec => ({ value: lec.id, label: lec.name })) : [];
  }, [selectedSubjectId, subjects]);

  const selectAllForPdf = () => {
    const allLectureIds = new Set<string>();
    subjects.forEach(sub => sub.lectures.forEach(lec => allLectureIds.add(lec.id)));
    setSelectedPdfLectures(allLectureIds);
  };

  const deselectAllForPdf = () => {
    setSelectedPdfLectures(new Set());
  };

  const generatePdf = () => {
    const doc = new jsPDF();
    const margin = 15;
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = margin;
    const baseFontSize = pdfTextSize;
    const subjectFontSize = baseFontSize * 1.4;
    const lectureFontSize = baseFontSize * 1.2;
    const questionFontSize = baseFontSize;
    // Fix for TypeScript spread operator errors by defining colors as tuples.
    // This ensures the spread operator passes a fixed number of arguments to doc.setTextColor.
    const defaultTextColor: [number, number, number] = [26, 32, 44];
    const darkTextColor: [number, number, number] = [26, 32, 44];

    const toc: { title: string; page: number; level: 'subject' | 'lecture' }[] = [];

    const addWrappedText = (text: string, x: number, yPos: number, options: { fontSize: number; fontStyle?: string; highlight?: boolean; }) => {
        const { fontSize, fontStyle = 'normal', highlight = false } = options;
        const textOptions = { lineHeightFactor: 1.25 };
        
        doc.setFont('helvetica', fontStyle);
        doc.setFontSize(fontSize);

        const lines = doc.splitTextToSize(text, doc.internal.pageSize.getWidth() - x - margin);
        const textMetrics = doc.getTextDimensions(lines, { fontSize, ...textOptions });
        const textBlockHeight = textMetrics.h;

        if (yPos + textBlockHeight > pageHeight - margin) {
            doc.addPage();
            yPos = margin;
        }

        if (highlight) {
            doc.setFillColor(252, 230, 148); // Gold highlight
            const singleLineMetrics = doc.getTextDimensions('M', { fontSize });
            const singleLineHeightWithFactor = singleLineMetrics.h * textOptions.lineHeightFactor;

            lines.forEach((line: string, index: number) => {
                const lineWidth = doc.getStringUnitWidth(line) * fontSize / doc.internal.scaleFactor;
                const currentLineY = yPos + (index * singleLineHeightWithFactor);
                const rectY = currentLineY - (singleLineMetrics.h * 0.85);
                const rectHeight = singleLineMetrics.h * 1.1;
                doc.rect(x - 1, rectY, lineWidth + 2, rectHeight, 'F');
            });
        }
        
        doc.setTextColor(...(highlight ? darkTextColor : defaultTextColor));
        doc.text(lines, x, yPos, textOptions);
        
        if (highlight) {
            doc.setTextColor(...defaultTextColor); // Reset text color
        }
        return yPos + textBlockHeight;
    };

    // --- PASS 1: Render Content & Gather TOC Data ---
    doc.setTextColor(...defaultTextColor); // Set default color for the whole document
    subjects.forEach(subject => {
        const selectedLectures = subject.lectures.filter(lec => selectedPdfLectures.has(lec.id));
        if (selectedLectures.length === 0) return;

        if (y + (subjectFontSize * 1.5) > pageHeight - margin) { doc.addPage(); y = margin; }
        toc.push({ title: subject.name, page: doc.getNumberOfPages(), level: 'subject' });
        y = addWrappedText(subject.name, margin, y, { fontSize: subjectFontSize, fontStyle: 'bold', highlight: true }) + 10;

        selectedLectures.forEach(lecture => {
            if (y + (lectureFontSize * 1.5) > pageHeight - margin) { doc.addPage(); y = margin; }
            toc.push({ title: lecture.name, page: doc.getNumberOfPages(), level: 'lecture' });
            y = addWrappedText(lecture.name, margin, y, { fontSize: lectureFontSize, fontStyle: 'bold', highlight: true }) + 8;

            lecture.questions.forEach((q, qIndex) => {
                y = addWrappedText(`${qIndex + 1}. ${q.question}`, margin, y, { fontSize: questionFontSize }) + 5;
                
                q.options.forEach((opt, oIndex) => {
                    const isCorrect = pdfShowAnswers && q.correctAnswer === oIndex;
                    const prefix = `${String.fromCharCode(97 + oIndex)}) `;
                    const textToRender = `${prefix}${opt}`;
                    y = addWrappedText(textToRender, margin + 5, y, { fontSize: questionFontSize, fontStyle: isCorrect ? 'bold' : 'normal', highlight: isCorrect }) + 2;
                });
                y += 8;
            });
        });
    });

    // --- PASS 2: Add TOC & Page Numbers ---
    const totalContentPages = doc.getNumberOfPages();
    // Fix for 'insertPage' error which expected 2 arguments.
    // This alternative approach of adding a page and moving it is more robust.
    doc.addPage();
    doc.movePage(totalContentPages + 1, 1);
    doc.setPage(1);

    y = margin;
    y = addWrappedText('Table of Contents', margin, y, { fontSize: subjectFontSize, fontStyle: 'bold' }) + 15;

    doc.setFontSize(baseFontSize);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...defaultTextColor);

    toc.forEach(entry => {
        if (y > pageHeight - margin) { doc.addPage(); y = margin; }
        const pageNumStr = String(entry.page);
        const x = entry.level === 'lecture' ? margin + 10 : margin;
        
        // Truncate title to fit
        const pageNumWidth = doc.getStringUnitWidth(pageNumStr) * baseFontSize / doc.internal.scaleFactor;
        const availableWidth = pageWidth - x - margin - pageNumWidth - 10;
        const truncatedTitle = doc.splitTextToSize(entry.title, availableWidth)[0];
        const titleWidth = doc.getStringUnitWidth(truncatedTitle) * baseFontSize / doc.internal.scaleFactor;

        // Render title and page number
        doc.text(truncatedTitle, x, y);
        doc.text(pageNumStr, pageWidth - margin, y, { align: 'right' });
        
        // Render dots
        const dotXStart = x + titleWidth + 2;
        const dotXEnd = pageWidth - margin - pageNumWidth - 2;
        const dotY = y - (baseFontSize * 0.25);
        doc.setLineDashPattern([0.5, 1.5], 0);
        if(dotXStart < dotXEnd) { // Only draw if there's space
            doc.line(dotXStart, dotY, dotXEnd, dotY);
        }
        // Fix: Reset the line dash pattern to solid by passing an empty array and phase 0.
        doc.setLineDashPattern([], 0);

        y += baseFontSize * 1.5;
    });

    for (let i = 2; i <= totalContentPages + 1; i++) {
        doc.setPage(i);
        const pageNumText = `Page ${i - 1} of ${totalContentPages}`;
        const fontSize = 10;
        doc.setFontSize(fontSize);

        // Add highlight
        const textMetrics = doc.getTextDimensions(pageNumText, { fontSize });
        const rectX = pageWidth - margin - textMetrics.w - 2;
        const rectY = pageHeight - 10 - textMetrics.h + 2;
        const rectWidth = textMetrics.w + 4;
        const rectHeight = textMetrics.h;
        doc.setFillColor(252, 230, 148); // Gold
        doc.rect(rectX, rectY, rectWidth, rectHeight, 'F');
        
        // Add text
        doc.setTextColor(...darkTextColor);
        doc.text(pageNumText, pageWidth - margin, pageHeight - 10, { align: 'right' });
        doc.setTextColor(...defaultTextColor); // Reset color
    }

    doc.save("Qsnap_Export.pdf");
    setIsPdfModalOpen(false);
  };
  
  const hasStagedQuestions = useMemo(() => extractionResults.some(r => r.questions.length > 0), [extractionResults]);

  const renderContent = () => {
    if (isDataLoading) {
      return (
          <div className="loading-overlay">
              <i className="fa-solid fa-spinner fa-spin"></i>
              <p>Loading your library...</p>
          </div>
      );
    }

    if (error) {
        return <div className="message error" style={{margin: '2rem'}}>{error}</div>
    }

    switch(currentView) {
      case 'home':
        return (
          <div className="page-container">
            <h1 className="page-title">Welcome to Qsnap</h1>
            <p className="page-subtitle">Your smart tool for creating and managing study materials.</p>
            <div className="home-cards">
              <div className="home-card" onClick={() => handleNavigation('add')}>
                <i className="fa-solid fa-plus card-icon"></i>
                <h2>Add New Questions</h2>
                <p>Upload an image to extract multiple-choice questions using AI.</p>
              </div>
              <div className="home-card" onClick={() => handleNavigation('library')}>
                <i className="fa-solid fa-book card-icon"></i>
                <h2>View Your Library</h2>
                <p>Organize, edit, and export your saved questions by subject and lecture.</p>
              </div>
            </div>
          </div>
        );
      case 'add':
        return (
          <>
            <div className="page-container add-questions-view">
              <div className="input-section">
                <h1 className="page-title">Step 1: Upload Images</h1>
                <div className="file-uploader">
                  <div className="file-uploader-header">
                    <label htmlFor="image-upload" className="file-uploader-label">
                      <i className="fa-solid fa-upload"></i> {images.length > 0 ? 'Change Images' : 'Upload Images'}
                    </label>
                    {images.length > 0 && (
                      <button onClick={handleClearImages} className="icon-button clear-button" title="Clear selected images">
                        <i className="fa-regular fa-circle-xmark"></i>
                      </button>
                    )}
                  </div>
                  <input id="image-upload" type="file" accept="image/*" onChange={handleImagesChange} multiple />
                  {imageUrls.length > 0 && (
                      <div className="image-previews-container">
                          {imageUrls.map((url, index) => (
                              <div className="image-preview thumbnail" key={url}>
                                  <img src={url} alt={`Preview ${index + 1}`} />
                              </div>
                          ))}
                      </div>
                  )}
                </div>
              
                {images.length > 0 && (
                  <div className="analyze-button-container">
                      <button className="analyze-button" onClick={analyzeImages} disabled={isLoading} title="Extract Questions">
                          {isLoading ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-check"></i>}
                      </button>
                  </div>
                )}
              </div>
              <div className="staging-area">
                <h2 className="title-small">Step 2: Review & Assign</h2>
                <div className="output-content">
                  {!isLoading && extractionResults.length > 0 && (
                      <div className="extraction-results-container">
                          {extractionResults.map((result, index) => (
                              <div key={index} className="extraction-result-item">
                                  <h3 className="image-result-title">Results for Image {index + 1}</h3>
                                  <div className="image-preview large">
                                      <img src={result.imageUrl} alt={`Analyzed ${index + 1}`} />
                                  </div>
                                  {result.error && <div className="message error">{result.error}</div>}
                                  {result.questions.length > 0 ? (
                                      <ul className="results-list">
                                          {result.questions.map(q => (
                                              <li key={q.id}>
                                                  <QuestionCard
                                                      question={q}
                                                      onCopy={handleCopy}
                                                      copiedId={copiedId}
                                                      isStaged={true}
                                                      onSelectAnswer={(optIndex) => handleSelectStagedAnswer(q.id, optIndex)}
                                                  />
                                              </li>
                                          ))}
                                      </ul>
                                  ) : (!result.error && <div className="message-small">No questions found in this image.</div>)}
                              </div>
                          ))}
                      </div>
                  )}
                  {!isLoading && extractionResults.length === 0 && images.length > 0 && (
                    <div className="message">Analysis complete.</div>
                  )}
                  {!isLoading && extractionResults.length === 0 && images.length === 0 && (
                    <div className="message">Upload one or more images to start extracting questions.</div>
                  )}
                </div>
                {hasStagedQuestions && (
                  <div className="assign-section">
                    <h3>Assign to Lecture</h3>
                    <CustomSelect
                      placeholder="Select Subject"
                      options={subjectOptions}
                      value={selectedSubjectId}
                      onChange={(val) => {
                        setSelectedSubjectId(val);
                        setSelectedLectureId('');
                      }}
                      disabled={subjectOptions.length === 0}
                    />
                    <CustomSelect
                      placeholder="Select Lecture"
                      options={lectureOptions}
                      value={selectedLectureId}
                      onChange={setSelectedLectureId}
                      disabled={!selectedSubjectId || lectureOptions.length === 0}
                    />
                    <button 
                      onClick={handleAddQuestionsToLecture} 
                      disabled={!selectedSubjectId || !selectedLectureId || !hasStagedQuestions}
                      title="Add Questions to Selected Lecture"
                    >
                      <i className="fa-solid fa-plus"></i> Add
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        );
      case 'library':
        const managedSubject = subjects.find(s => s.id === selectedManageSubjectId);
        const selectedManagedLecture = managedSubject?.lectures.find(lec => lec.id === selectedManageLectureId);

        if (!managedSubject) {
          return (
            <div className="page-container library-view library-placeholder">
              <div className="placeholder-content">
                <i className="fa-solid fa-book-open placeholder-icon"></i>
                <h2>Your Question Library</h2>
                <p className="page-subtitle">Select a subject from the sidebar, or create a new one to get started.</p>
                <div className="form-group create-subject-form">
                  <label htmlFor="new-subject-name">Create New Subject</label>
                  <form onSubmit={handleAddSubject} className="inline-form">
                    <input
                      id="new-subject-name"
                      type="text"
                      value={newSubjectName}
                      onChange={(e) => setNewSubjectName(e.target.value)}
                      placeholder="e.g., Surgery"
                    />
                    <button type="submit"><i className="fa-solid fa-plus"></i> Create Subject</button>
                  </form>
                </div>
              </div>
            </div>
          );
        }

        // --- RENDER LECTURE PAGE ---
        if (selectedManagedLecture) {
            return (
                <div className="page-container library-view lecture-page">
                    <header className="lecture-page-header">
                        <button className="back-button" onClick={() => setSelectedManageLectureId('')}>
                            <i className="fa-solid fa-arrow-left"></i> Back to {managedSubject.name}
                        </button>
                        <div className="header-main">
                            <h2 className="page-title">{selectedManagedLecture.name}</h2>
                            <div className="settings-container">
                                <button onClick={() => setIsLectureSettingsOpen(prev => !prev)} className="icon-button settings-button">
                                    <i className="fa-solid fa-gear"></i>
                                </button>
                                {isLectureSettingsOpen && (
                                    <div className="settings-popup" ref={lectureSettingsRef}>
                                        <button onClick={() => { setEditingLecture({ id: selectedManagedLecture.id, name: selectedManagedLecture.name, subjectId: managedSubject.id }); setIsLectureSettingsOpen(false); }}>
                                            <i className="fa-solid fa-pencil"></i> Edit Name
                                        </button>
                                        <button onClick={() => handleInitiateDeleteLecture(managedSubject.id, selectedManagedLecture.id)}>
                                            <i className="fa-solid fa-trash"></i> Delete Lecture
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </header>
                    <section className="questions-section">
                        {selectedManagedLecture.questions.length > 0 ? (
                            <ul className="results-list">
                                {selectedManagedLecture.questions.map(q => (
                                    <li key={q.id}>
                                        <QuestionCard
                                            question={q}
                                            onCopy={handleCopy}
                                            copiedId={copiedId}
                                            onStartEdit={handleStartEditQuestion}
                                            onSaveEdit={handleSaveEdit}
                                            onCancelEdit={handleCancelEdit}
                                            editingQuestionId={editingQuestionId}
                                            editedContent={editedContent}
                                            onEditInputChange={handleEditInputChange}
                                            onEditCorrectAnswerChange={handleEditCorrectAnswerChange}
                                            onDelete={() => handleDeleteQuestion(managedSubject.id, selectedManagedLecture.id, q.id)}
                                        />
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <div className="message-small">No questions in this lecture yet.</div>
                        )}
                    </section>
                </div>
            );
        }

        // --- RENDER SUBJECT PAGE ---
        return (
          <div className="page-container library-view subject-page">
            <header className="subject-page-header">
              <h1 className="page-title">{managedSubject.name}</h1>
              <div className="settings-container">
                <button onClick={() => setIsSubjectSettingsOpen(prev => !prev)} className="icon-button settings-button">
                    <i className="fa-solid fa-gear"></i>
                </button>
                {isSubjectSettingsOpen && (
                    <div className="settings-popup" ref={subjectSettingsRef}>
                        <button onClick={() => { setManagedSubjectName(managedSubject.name); setEditingSubject(managedSubject); setIsSubjectSettingsOpen(false); }}>
                           <i className="fa-solid fa-pencil"></i> Edit Name
                        </button>
                        <button onClick={() => handleInitiateDeleteSubject(managedSubject.id)}>
                           <i className="fa-solid fa-trash"></i> Delete Subject
                        </button>
                    </div>
                )}
              </div>
            </header>

            <section className="lectures-section">
              <h2 className="section-title">Lectures</h2>
              <div className="lecture-grid">
                <div className="add-lecture-card">
                    <form className="add-lecture-form" onSubmit={(e) => handleAddLecture(e, managedSubject.id)}>
                        <input
                        type="text"
                        value={newLectureNames[managedSubject.id] || ''}
                        onChange={(e) => setNewLectureNames(prev => ({ ...prev, [managedSubject.id]: e.target.value }))}
                        placeholder="Add a new lecture..."
                        />
                        <button type="submit"><i className="fa-solid fa-plus"></i> Add Lecture</button>
                    </form>
                </div>
                {managedSubject.lectures.map(lecture => (
                    <div key={lecture.id} className="lecture-card" onClick={() => setSelectedManageLectureId(lecture.id)}>
                        <h3 className="lecture-card-title">{lecture.name}</h3>
                        <p className="lecture-card-info">{lecture.questions.length} question{lecture.questions.length !== 1 ? 's' : ''}</p>
                    </div>
                ))}
              </div>
            </section>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="app-layout">
       {isSidebarOpen && window.innerWidth <= 1024 && <div className="overlay" onClick={() => setIsSidebarOpen(false)}></div>}
      <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <h1 className="sidebar-title" onClick={() => handleNavigation('home')}>Qsnap</h1>
        <div className="sidebar-scrollable-content">
          <nav className="sidebar-nav">
            <button className={`nav-item ${currentView === 'add' ? 'active' : ''}`} onClick={() => handleNavigation('add')}>
              <i className="fa-solid fa-plus"></i>
              <span>Add Questions</span>
            </button>
            <button className={`nav-item ${currentView === 'library' ? 'active' : ''}`} onClick={() => handleNavigation('library')}>
              <i className="fa-solid fa-book"></i>
              <span>Question Library</span>
            </button>
          </nav>

          <div className="sidebar-subjects-section">
            <h2 className="sidebar-subjects-title">Subjects</h2>
            <div className="sidebar-subjects-list">
              {subjects.length > 0 ? (
                subjects.map(subject => (
                  <button 
                    key={subject.id}
                    className={`subject-item ${selectedManageSubjectId === subject.id && currentView === 'library' ? 'active' : ''}`}
                    onClick={() => handleNavigation('library', subject.id)}
                    title={subject.name}
                  >
                    <i className="fa-solid fa-folder"></i>
                    <span>{subject.name}</span>
                  </button>
                ))
              ) : (
                <p className="no-subjects-message">No subjects yet.</p>
              )}
            </div>
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="save-status-indicator">
              {saveStatus === 'saving' && <><i className="fa-solid fa-spinner fa-spin"></i> Saving...</>}
              {saveStatus === 'saved' && !isInitialLoad.current && <><i className="fa-solid fa-check"></i> All changes saved</>}
              {saveStatus === 'error' && <><i className="fa-solid fa-circle-xmark"></i> Save Error</>}
          </div>
          <button className="export-button" onClick={() => setIsPdfModalOpen(true)} disabled={subjects.length === 0}>
             <i className="fa-solid fa-file-pdf"></i> Export to PDF
          </button>
        </div>
      </aside>
      <main className="main-content">
        <button className="sidebar-toggle" onClick={() => setIsSidebarOpen(!isSidebarOpen)} aria-label="Toggle navigation menu">
            <i className="fa-solid fa-bars"></i>
        </button>
        {renderContent()}
      </main>

      {isDeleteModalOpen && (
        <div className="modal-overlay">
          <div className="simple-modal">
            <h2 className="modal-title">Confirm Deletion</h2>
            <form onSubmit={handleConfirmDelete}>
              <p>This action is permanent and cannot be undone. To confirm, please type <strong>delete</strong> below.</p>
              <input
                type="text"
                value={deleteConfirmation}
                onChange={(e) => {
                  setDeleteConfirmation(e.target.value);
                  setDeleteConfirmationError('');
                }}
                placeholder='Type "delete" here'
                autoFocus
              />
              {deleteConfirmationError && <p className="modal-error">{deleteConfirmationError}</p>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={handleCancelDelete}>Cancel</button>
                <button type="submit" className="delete-button" disabled={deleteConfirmation.toLowerCase() !== 'delete'}>
                  Confirm Delete
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingSubject && (
          <div className="modal-overlay">
              <div className="simple-modal">
                  <h2 className="modal-title">Edit Subject Name</h2>
                  <form onSubmit={handleUpdateSubject}>
                      <input
                          type="text"
                          value={managedSubjectName}
                          onChange={(e) => setManagedSubjectName(e.target.value)}
                          autoFocus
                      />
                      <div className="modal-actions">
                          <button type="button" className="btn-secondary" onClick={() => setEditingSubject(null)}>Cancel</button>
                          <button type="submit">Save</button>
                      </div>
                  </form>
              </div>
          </div>
      )}

      {editingLecture && (
            <div className="modal-overlay">
                <div className="simple-modal">
                    <h2 className="modal-title">Edit Lecture Name</h2>
                    <form onSubmit={handleSaveLecture}>
                      <input
                          type="text"
                          value={editingLecture.name}
                          onChange={(e) => setEditingLecture({ ...editingLecture, name: e.target.value })}
                          autoFocus
                      />
                        <div className="modal-actions">
                            <button type="button" className="btn-secondary" onClick={() => setEditingLecture(null)}>Cancel</button>
                            <button type="submit">Save</button>
                        </div>
                    </form>
                </div>
            </div>
      )}

      {isPdfModalOpen && (
        <div className="modal-overlay">
          <div className="pdf-modal">
            <h2 className="modal-title">Export to PDF</h2>
            <div className="modal-content">
              <div className="modal-section">
                {!pdfSelectedSubjectIdForView ? (
                  <>
                    <h3>Select Content</h3>
                    <div className="pdf-select-actions">
                      <button className="btn-secondary" onClick={selectAllForPdf}>Select All</button>
                      <button className="btn-secondary" onClick={deselectAllForPdf}>Deselect All</button>
                    </div>
                    <div className="pdf-selection-list">
                      {subjects.map(subject => {
                        const selectedCount = subject.lectures.filter(lec => selectedPdfLectures.has(lec.id)).length;
                        const totalCount = subject.lectures.length;
                        return (
                          <button
                            key={subject.id}
                            className="pdf-subject-item"
                            onClick={() => setPdfSelectedSubjectIdForView(subject.id)}
                            disabled={totalCount === 0}
                            title={totalCount === 0 ? "This subject has no lectures" : `View lectures for ${subject.name}`}
                          >
                            <div className="pdf-subject-item-main">
                              <i className="fa-solid fa-folder"></i>
                              <span>{subject.name}</span>
                            </div>
                            <div className="pdf-subject-item-details">
                              <span>{selectedCount} / {totalCount}</span>
                              <i className="fa-solid fa-chevron-right"></i>
                            </div>
                          </button>
                        );
                      })}
                       {subjects.length === 0 && <p className="no-subjects-message">No subjects in your library to export.</p>}
                    </div>
                  </>
                ) : (
                  <>
                    {(() => {
                      const subject = subjects.find(s => s.id === pdfSelectedSubjectIdForView);
                      if (!subject) return null;

                      const handleSubjectSelectAll = () => {
                        const newSelection = new Set(selectedPdfLectures);
                        subject.lectures.forEach(lec => newSelection.add(lec.id));
                        setSelectedPdfLectures(newSelection);
                      };

                      const handleSubjectDeselectAll = () => {
                        const newSelection = new Set(selectedPdfLectures);
                        subject.lectures.forEach(lec => newSelection.delete(lec.id));
                        setSelectedPdfLectures(newSelection);
                      };

                      return (
                        <>
                          <div className="pdf-lecture-view-header">
                            <button className="icon-button" onClick={() => setPdfSelectedSubjectIdForView(null)} title="Back to subjects">
                              <i className="fa-solid fa-angle-left"></i>
                            </button>
                            <h3>{subject.name}</h3>
                          </div>
                          <div className="pdf-select-actions">
                            <button className="btn-secondary" onClick={handleSubjectSelectAll}>Select All in Subject</button>
                            <button className="btn-secondary" onClick={handleSubjectDeselectAll}>Deselect All in Subject</button>
                          </div>
                          <div className="pdf-selection-list">
                            {subject.lectures.map(lecture => (
                              <div key={lecture.id} className="pdf-select-item">
                                <input
                                  type="checkbox"
                                  id={`pdf-lec-${lecture.id}`}
                                  checked={selectedPdfLectures.has(lecture.id)}
                                  onChange={(e) => {
                                    const newLectures = new Set(selectedPdfLectures);
                                    if (e.target.checked) newLectures.add(lecture.id);
                                    else newLectures.delete(lecture.id);
                                    setSelectedPdfLectures(newLectures);
                                  }}
                                />
                                <label htmlFor={`pdf-lec-${lecture.id}`}>{lecture.name}</label>
                              </div>
                            ))}
                            {subject.lectures.length === 0 && <p className="no-subjects-message">This subject has no lectures.</p>}
                          </div>
                        </>
                      );
                    })()}
                  </>
                )}
              </div>
              <div className="modal-section">
                <h3>Formatting</h3>
                <div className="format-options">
                  <div className="format-group">
                    <label htmlFor="pdf-text-size">Base Text Size (px)</label>
                    <input
                      id="pdf-text-size"
                      type="number"
                      value={pdfTextSize}
                      onChange={(e) => setPdfTextSize(parseInt(e.target.value, 10) || 0)}
                      className="margin-input"
                    />
                  </div>
                  <div className="format-group">
                    <div className="checkbox-group">
                      <input
                        type="checkbox"
                        id="pdf-show-answers"
                        checked={pdfShowAnswers}
                        onChange={(e) => setPdfShowAnswers(e.target.checked)}
                      />
                      <label htmlFor="pdf-show-answers">Show Correct Answers</label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => { setIsPdfModalOpen(false); setPdfSelectedSubjectIdForView(null); }}>Cancel</button>
              <button onClick={generatePdf} disabled={selectedPdfLectures.size === 0}>Generate PDF</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);