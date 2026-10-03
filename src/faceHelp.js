import { reviewRequest } from './visualReview';

export const getFaceQuestions = body => reviewRequest('/help/questions', body);
export const saveFaceAnswer = body => reviewRequest('/help/answer', body);
export const undoFaceAnswer = body => reviewRequest('/help/undo', body);

export function personForName(people, name) {
  const matches = people.filter(person => person.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase());
  return matches.length === 1 ? matches[0] : null;
}

export function comparisonFace(question, person) {
  if (!person) return null;
  if (person.id === question.suggestion?.id) return question.suggestion.reference_id;
  return person.reference_ids?.find(id => id !== question.face_id) || null;
}
