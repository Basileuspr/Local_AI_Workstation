import { reviewFileMessage, reviewStatus, reviewStatusLabels } from '../imageReview';

export default function ReviewRecordDetails({ image }) {
  const message = reviewFileMessage(image);
  return <>
    {message && <p role="status">{message} Saved review metadata is retained.</p>}
    <details><summary>Saved review details</summary><dl>
      <dt>Review status</dt><dd>{reviewStatusLabels[reviewStatus(image)]}</dd>
      <dt>Category</dt><dd>{image.category || 'Unassigned'}</dd>
      <dt>Project</dt><dd>{image.project || 'Unassigned'}</dd>
      <dt>Favorite</dt><dd>{image.favorite ? 'Yes' : 'No'}</dd>
      <dt>Current file</dt><dd style={{overflowWrap:'anywhere'}}>{image.path || 'Location unavailable'}</dd>
    </dl></details>
  </>;
}
