import { useEffect, useRef } from 'react';
import type { Student } from '../lib/supabase';
import Modal from './Modal';
import { QuestionnaireView } from './CandidateEditor';

/** Internal display of existing answers. No editor, save, export or contact actions. */
export default function StudentApplicationView({ student, onClose }: { student: Student; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const keepFocus = (event: KeyboardEvent) => {
      // The only action is closing. Never tab into contact controls behind the dialog.
      if (event.key === 'Tab') { event.preventDefault(); closeRef.current?.focus(); }
    };
    document.addEventListener('keydown', keepFocus);
    return () => {
      document.removeEventListener('keydown', keepFocus);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return (
    <Modal onClose={onClose} closeButtonRef={closeRef}
      dialogLabel={`טופס הגשת מועמדות — ${student.name || 'סטודנט/ית'}`}>
      <section dir="rtl" className="p-5 sm:p-8">
        <div className="flex items-start gap-3 justify-between">
          <div className="min-w-0">
            <h2 className="serif text-[24px]" style={{ color: 'var(--ink)', overflowWrap: 'anywhere' }}>טופס הגשת מועמדות</h2>
            <p className="mt-2 font-semibold" style={{ overflowWrap: 'anywhere' }}>{student.name}</p>
            <p className="text-[12px] mt-1" style={{ color: 'var(--text-soft)' }}>תשובות השאלון השמורות במערכת · קריאה בלבד</p>
          </div>
        </div>
        {student.questionnaire
          ? <QuestionnaireView q={student.questionnaire} candidateName={student.name} displayOnly />
          : <p className="mt-6" style={{ color: 'var(--text-soft)' }}>לא נשמרו תשובות לטופס הגשת המועמדות ברשומה זו.</p>}
        {student.formUrl && !student.questionnaire && <p className="mt-3 text-[13px]" style={{ color: 'var(--text-soft)' }}>
          ברשומה קיים קישור למסמך מצורף. אפשר לפתוח אותו בכרטיס הסטודנט, תחת מסמכים וחוו״ד מעסיק.
        </p>}
      </section>
    </Modal>
  );
}
