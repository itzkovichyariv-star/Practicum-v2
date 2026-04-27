import type { PracticumData } from './supabase';

export type UserPermissions = {
  role: 'admin' | 'coordinator';
  /** Filter by course name substring — coordinator sees only courses whose name contains this string. */
  courseNameFilter?: string;
};

const ROLE_MAP: Record<string, UserPermissions> = {
  'rachelshal@ariel.ac.il': {
    role: 'coordinator',
    courseNameFilter: 'פרקטיקום משאבי אנוש',
  },
};

export function permissionsFor(email: string | null | undefined): UserPermissions {
  if (!email) return { role: 'admin' };
  return ROLE_MAP[email.toLowerCase().trim()] ?? { role: 'admin' };
}

export function filterByPermissions(data: PracticumData, perms: UserPermissions): PracticumData {
  const filter = perms.courseNameFilter;
  if (!filter) return data;

  // Find course IDs whose name contains the filter string (all years automatically included)
  const allowedIds = new Set(
    (data.courses || [])
      .filter(c => c.name?.includes(filter))
      .map(c => c.id)
  );

  return {
    ...data,
    courses:    (data.courses    || []).filter(c => allowedIds.has(c.id)),
    students:   (data.students   || []).filter(s => allowedIds.has(s.courseId)),
    lectures:   (data.lectures   || []).filter(l => allowedIds.has(l.courseId ?? '')),
    candidates: (data.candidates || []).filter(c => allowedIds.has(c.courseId)),
    employers:  (data.employers  || []).filter(e => allowedIds.has(e.courseId ?? '')),
    trainers:   (data.trainers   || []).filter(t => allowedIds.has(t.courseId)),
  };
}

export function describePermissions(perms: UserPermissions): string {
  if (perms.role === 'admin') return 'מנהל';
  return perms.courseNameFilter ? `רכזת · ${perms.courseNameFilter}` : 'רכזת';
}
