'use client';
import { useState } from 'react';
import { ActionForm, SubmitButton, type ActionResult } from '../../../components/ActionForm';

type Labels = Record<
  | 'kind'
  | 'kindContract'
  | 'kindShariah'
  | 'title'
  | 'forVersion'
  | 'reviewer'
  | 'reviewedOn'
  | 'status'
  | 'notes'
  | 'file'
  | 'upload',
  string
> & { statuses: Record<string, string> };

/** Upload the lawyer's contract or the Shariah review (fields depend on the type). */
export function LegalUploadForm({
  action,
  currentVersion,
  labels,
}: {
  action: (p: ActionResult, d: FormData) => Promise<ActionResult>;
  currentVersion: number;
  labels: Labels;
}) {
  const [kind, setKind] = useState<'SHARIAH_REVIEW' | 'CONTRACT_SOURCE'>('SHARIAH_REVIEW');
  return (
    <ActionForm action={action} resetOnSuccess>
      <div className="form-row">
        <label>
          {labels.kind}
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="SHARIAH_REVIEW">{labels.kindShariah}</option>
            <option value="CONTRACT_SOURCE">{labels.kindContract}</option>
          </select>
        </label>
        <label>
          {labels.title}
          <input name="title" required minLength={3} maxLength={200} />
        </label>
      </div>
      {kind === 'CONTRACT_SOURCE' ? (
        <label style={{ maxWidth: 200 }}>
          {labels.forVersion}
          <input
            name="contractVersion"
            type="number"
            min={1}
            defaultValue={currentVersion}
            required
          />
        </label>
      ) : (
        <div className="form-row">
          <label>
            {labels.status}
            <select name="status" defaultValue="PENDING">
              {Object.entries(labels.statuses).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            {labels.reviewer}
            <input name="reviewer" maxLength={200} />
          </label>
          <label>
            {labels.reviewedOn}
            <input name="reviewedOn" type="date" />
          </label>
        </div>
      )}
      <label>
        {labels.notes}
        <textarea name="notes" maxLength={2000} />
      </label>
      <label>
        {labels.file}
        <input
          name="file"
          type="file"
          required
          accept=".pdf,.docx,.png,.jpg,.jpeg,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg"
        />
      </label>
      <div>
        <SubmitButton>{labels.upload}</SubmitButton>
      </div>
    </ActionForm>
  );
}
