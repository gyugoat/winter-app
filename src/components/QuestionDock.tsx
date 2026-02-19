/**
 * QuestionDock — floating panel that presents AI-driven multiple-choice questions.
 *
 * Appears above the message input when `useQuestion` detects a pending question
 * from the OpenCode backend. Supports single and multi-select modes, optional
 * custom text input, and a dismiss button.
 */
import { useState, type KeyboardEvent } from 'react';
import type { QuestionRequest, QuestionInfo } from '../hooks/useQuestion';
import { useI18n } from '../i18n';
import '../styles/question.css';

interface QuestionDockProps {
  request: QuestionRequest;
  onReply: (requestID: string, answers: string[][]) => void;
  onReject: (requestID: string) => void;
}

interface SingleQuestionProps {
  info: QuestionInfo;
  index: number;
  selections: string[][];
  onToggle: (index: number, label: string) => void;
  customValues: string[];
  onCustomChange: (index: number, value: string) => void;
  onCustomSubmit: (index: number) => void;
}

function SingleQuestion({
  info,
  index,
  selections,
  onToggle,
  customValues,
  onCustomChange,
  onCustomSubmit,
}: SingleQuestionProps) {
  const { t } = useI18n();
  const selected = selections[index] ?? [];
  const showCustom = info.custom !== false;

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onCustomSubmit(index);
    }
  };

  return (
    <div>
      <div className="question-header">{info.question}</div>
      <div className="question-options">
        {info.options.map((opt) => (
          <button
            key={opt.label}
            className={`question-option${selected.includes(opt.label) ? ' selected' : ''}`}
            onClick={() => onToggle(index, opt.label)}
          >
            <span className="question-option-label">{opt.label}</span>
            {opt.description && (
              <span className="question-option-desc">{opt.description}</span>
            )}
          </button>
        ))}
      </div>
      {showCustom && (
        <input
          className="question-custom"
          type="text"
          placeholder={t('questionCustomPlaceholder')}
          value={customValues[index] ?? ''}
          onChange={(e) => onCustomChange(index, e.target.value)}
          onKeyDown={handleKeyDown}
        />
      )}
    </div>
  );
}

export function QuestionDock({ request, onReply, onReject }: QuestionDockProps) {
  const { t } = useI18n();
  const isMulti = request.questions.some((q) => q.multiple);

  const [selections, setSelections] = useState<string[][]>(
    request.questions.map(() => [])
  );
  const [customValues, setCustomValues] = useState<string[]>(
    request.questions.map(() => '')
  );

  const toggle = (qIndex: number, label: string) => {
    const info = request.questions[qIndex];
    setSelections((prev) => {
      const next = [...prev];
      const cur = next[qIndex] ?? [];
      if (info.multiple) {
        next[qIndex] = cur.includes(label)
          ? cur.filter((l) => l !== label)
          : [...cur, label];
      } else {
        next[qIndex] = [label];
        if (!isMulti) {
          const answers = request.questions.map((_, i) =>
            i === qIndex ? [label] : (next[i] ?? [])
          );
          onReply(request.id, answers);
        }
      }
      return next;
    });
  };

  const handleCustomChange = (index: number, value: string) => {
    setCustomValues((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleCustomSubmit = (index: number) => {
    const val = customValues[index]?.trim();
    if (!val) return;
    const answers = request.questions.map((_, i) =>
      i === index ? [val] : (selections[i] ?? [])
    );
    onReply(request.id, answers);
  };

  const handleConfirm = () => {
    const answers = request.questions.map((_, i) => selections[i] ?? []);
    onReply(request.id, answers);
  };

  const hasSelection = selections.some((s) => s.length > 0);

  return (
    <div className="question-dock">
      <div className="question-dock-inner">
        <button
          className="question-dismiss"
          onClick={() => onReject(request.id)}
          aria-label={t('questionSkip')}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        {request.questions.map((info, i) => (
          <SingleQuestion
            key={i}
            info={info}
            index={i}
            selections={selections}
            onToggle={toggle}
            customValues={customValues}
            onCustomChange={handleCustomChange}
            onCustomSubmit={handleCustomSubmit}
          />
        ))}
        {isMulti && (
          <div className="question-actions">
            <button className="question-btn-skip" onClick={() => onReject(request.id)}>
              {t('questionSkip')}
            </button>
            <button
              className="question-btn-confirm"
              onClick={handleConfirm}
              disabled={!hasSelection}
            >
              {t('questionConfirm')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
