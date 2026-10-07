import {reviewStatuses,reviewStatusLabels,reviewStatus} from '../imageReview';
export {reviewStatuses} from '../imageReview';
export default function ReviewFieldsEditor({value,onChange,disabled=false}) {
  return <div className="review-fields-editor">
    <label>Review<select aria-label="Review status" disabled={disabled} value={reviewStatus(value)} onChange={e=>onChange({...value,review_status:e.target.value,rating:({accepted:'liked',rejected:'disliked'})[e.target.value]||null})}>{reviewStatuses.map(status=><option key={status} value={status}>{reviewStatusLabels[status]}</option>)}</select></label>
    <label>Category<input aria-label="Review category" disabled={disabled} maxLength={120} value={value.category||''} onChange={e=>onChange({...value,category:e.target.value})}/></label>
    <label>Project<input aria-label="Review project" disabled={disabled} maxLength={120} value={value.project||''} onChange={e=>onChange({...value,project:e.target.value})}/></label>
    <label title="Bookmark this item independently of its review rating"><input aria-label="Review favorite" type="checkbox" disabled={disabled} checked={!!value.favorite} onChange={e=>onChange({...value,favorite:e.target.checked})}/>★ Favorite</label>
  </div>;
}
