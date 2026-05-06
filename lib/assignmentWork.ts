export type AssignmentWorkLike = {
  work_started_at: string | null
  work_completed_at: string | null
}

export type AssignmentWorkState = 'idle' | 'started' | 'completed'

export function getAssignmentWorkState(
  assignment: AssignmentWorkLike | null | undefined
): AssignmentWorkState {
  if (!assignment) return 'idle'
  if (assignment.work_completed_at) return 'completed'
  if (assignment.work_started_at) return 'started'
  return 'idle'
}

export function hasOpenJobWork(
  assignments: Array<AssignmentWorkLike | null | undefined>
): boolean {
  return assignments.some((assignment) => getAssignmentWorkState(assignment) === 'started')
}
