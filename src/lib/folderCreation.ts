/**
 * OneDrive folder creation via File System Access API.
 * Ported from v1. Works in Chrome/Edge on desktop. No IT approval needed —
 * the user grants scoped read-write permission to a single directory (OneDrive's
 * local "data" folder). OneDrive then syncs the created subfolders to the cloud.
 *
 * Safari / mobile / Firefox: showDirectoryPicker is unavailable → returns null,
 * caller should show a fallback message.
 */

import type { Course, Student, Employer, Candidate, PracticumData } from './supabase';
import { normalizeYear } from './session';

export const FILE_FOLDERS: Record<string, string> = {
  cv:          'קורות_חיים',
  form:        'טפסי_הגשה',
  summary:     'סיכומי_ראיון',
  feedback:    'חוות_דעת_ארגון',
  application: 'טפסי_מועמדות',
};

let dataDirectoryHandle: any = null;

export function isSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function getOrRequestDataDir(force = false): Promise<any> {
  if (!isSupported()) return null;
  const w = window as any;

  if (dataDirectoryHandle && !force) {
    try {
      const perm = await dataDirectoryHandle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') return dataDirectoryHandle;
      const req = await dataDirectoryHandle.requestPermission({ mode: 'readwrite' });
      if (req === 'granted') return dataDirectoryHandle;
    } catch { /* re-pick */ }
  }

  alert(
    'בחר את תיקיית "data" שבתוך תיקיית המערכת ב‑OneDrive:\n\n' +
    'OneDrive → Yariv → מערכת לניהול פרקטיקום → data\n\n' +
    '(הפעולה תידרש פעם אחת בלבד בכל מכשיר / דפדפן)'
  );

  try {
    dataDirectoryHandle = await w.showDirectoryPicker({
      id: 'practicum-data',
      mode: 'readwrite',
      startIn: 'documents',
    });
    return dataDirectoryHandle;
  } catch (err: any) {
    if (err?.name !== 'AbortError') alert('שגיאה: ' + (err?.message || err));
    return null;
  }
}

async function dirExists(parent: any, name: string): Promise<boolean> {
  try {
    await parent.getDirectoryHandle(name, { create: false });
    return true;
  } catch {
    return false;
  }
}

export type CreateResult = {
  ok: boolean;
  created: number;
  alreadyExisted: boolean;
  message: string;
};

export async function createCourseFolders(
  year: string,
  courseName: string,
  folderKeys: string[] = Object.keys(FILE_FOLDERS),
): Promise<CreateResult> {
  const dataDir = await getOrRequestDataDir();
  if (!dataDir) {
    return { ok: false, created: 0, alreadyExisted: false, message: 'לא נבחרה תיקיית יעד' };
  }
  const courseFolder = courseName.replace(/\s+/g, '_');
  const selectedFolderNames = folderKeys.map(k => FILE_FOLDERS[k]).filter(Boolean);

  try {
    const yearDir = await dataDir.getDirectoryHandle(year, { create: true });
    const courseExisted = await dirExists(yearDir, courseFolder);
    const courseDir = await yearDir.getDirectoryHandle(courseFolder, { create: true });

    let newlyCreated = 0;
    for (const fname of selectedFolderNames) {
      const existed = await dirExists(courseDir, fname);
      await courseDir.getDirectoryHandle(fname, { create: true });
      if (!existed) newlyCreated++;
    }

    if (courseExisted && newlyCreated === 0) {
      return {
        ok: true,
        created: 0,
        alreadyExisted: true,
        message: `כל התיקיות כבר קיימות עבור ${year}/${courseFolder}`,
      };
    }
    if (courseExisted) {
      return {
        ok: true,
        created: newlyCreated,
        alreadyExisted: false,
        message: `נוספו ${newlyCreated} תיקיות חסרות ב‑${year}/${courseFolder}`,
      };
    }
    return {
      ok: true,
      created: selectedFolderNames.length,
      alreadyExisted: false,
      message: `נוצרו ${selectedFolderNames.length} תיקיות עבור ${year}/${courseFolder}`,
    };
  } catch (err: any) {
    return {
      ok: false,
      created: 0,
      alreadyExisted: false,
      message: 'שגיאה: ' + (err?.message || err),
    };
  }
}

export type BulkResult = {
  ok: boolean;
  fullyCreated: number;
  partiallyFilled: number;
  alreadyExisted: number;
  errors: number;
  log: string[];
};

export async function createFoldersForAllCourses(data: PracticumData): Promise<BulkResult> {
  const empty: BulkResult = { ok: false, fullyCreated: 0, partiallyFilled: 0, alreadyExisted: 0, errors: 0, log: [] };
  const dataDir = await getOrRequestDataDir();
  if (!dataDir) return empty;

  const courses: Course[] = data.courses || [];
  const students: Student[] = data.students || [];
  const employers: Employer[] = data.employers || [];
  const candidates: Candidate[] = data.candidates || [];
  const academicYears = data.academicYears || [];

  const combos = new Set<string>();
  courses.forEach(c => {
    const yearsForCourse = new Set<string>();
    students.forEach(s => { if (s.courseId === c.id && s.year) yearsForCourse.add(normalizeYear(s.year)); });
    employers.forEach(e => { if (e.courseId === c.id && e.year) yearsForCourse.add(normalizeYear(e.year)); });
    candidates.forEach(x => { if (x.courseId === c.id && x.year) yearsForCourse.add(normalizeYear(x.year)); });
    if (c.year) yearsForCourse.add(normalizeYear(c.year));
    if (yearsForCourse.size === 0) academicYears.forEach(y => yearsForCourse.add(y));
    yearsForCourse.forEach(y => combos.add(y + '|' + c.name));
  });

  const folderNames = Object.values(FILE_FOLDERS);
  const result: BulkResult = { ok: true, fullyCreated: 0, partiallyFilled: 0, alreadyExisted: 0, errors: 0, log: [] };

  for (const combo of combos) {
    const [year, courseName] = combo.split('|');
    const courseFolder = courseName.replace(/\s+/g, '_');
    try {
      const yearDir = await dataDir.getDirectoryHandle(year, { create: true });
      const courseExisted = await dirExists(yearDir, courseFolder);
      const courseDir = await yearDir.getDirectoryHandle(courseFolder, { create: true });

      let newlyCreated = 0;
      for (const fname of folderNames) {
        const existed = await dirExists(courseDir, fname);
        await courseDir.getDirectoryHandle(fname, { create: true });
        if (!existed) newlyCreated++;
      }

      if (courseExisted && newlyCreated === 0) {
        result.alreadyExisted++;
        result.log.push(`⚠️ ${year}/${courseFolder} — כבר קיים`);
      } else if (courseExisted && newlyCreated > 0) {
        result.partiallyFilled++;
        result.log.push(`🔧 ${year}/${courseFolder} — הוסיף ${newlyCreated} תיקיות חסרות`);
      } else {
        result.fullyCreated++;
        result.log.push(`✓ ${year}/${courseFolder} — נוצר (${newlyCreated} תיקיות)`);
      }
    } catch (err: any) {
      result.errors++;
      result.log.push(`✗ ${year}/${courseFolder} — ${err?.message || err}`);
    }
  }
  return result;
}
