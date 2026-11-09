'use client';
import { useState, useTransition } from 'react';
import { ActionForm, SubmitButton } from '../../../components/ActionForm';
import { previewConfig, publishConfig, type PreviewResult } from '../actions';

type Labels = Record<
  | 'preview'
  | 'publish'
  | 'notes'
  | 'noChanges'
  | 'changes'
  | 'field'
  | 'before'
  | 'after'
  | 'confirm',
  string
>;

const show = (v: unknown) => (v === undefined ? '—' : JSON.stringify(v));

/** JSON editor with server-side validation + diff preview before publishing (super_admin). */
export function ConfigEditor({
  initial,
  editable,
  labels,
}: {
  initial: string;
  editable: boolean;
  labels: Labels;
}) {
  const [text, setText] = useState(initial);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="stack">
      <textarea
        className="code"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
        }}
        readOnly={!editable}
        spellCheck={false}
        aria-label="config JSON"
      />
      {editable ? (
        <div className="row">
          <button
            type="button"
            className="btn secondary"
            disabled={pending}
            onClick={() => start(async () => setPreview(await previewConfig(text)))}
          >
            {pending ? '…' : labels.preview}
          </button>
        </div>
      ) : null}
      {preview && !preview.ok ? <div className="banner bad">{preview.message}</div> : null}
      {preview && preview.ok ? (
        <>
          {!preview.valid ? (
            <div className="banner bad">
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {preview.issues.map((i) => (
                  <li key={i} className="mono">
                    {i}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {preview.diff.length === 0 ? (
            <div className="banner">{labels.noChanges}</div>
          ) : (
            <div className="table-wrap">
              <h3 style={{ margin: '4px 0 8px' }}>
                {labels.changes} ({preview.diff.length})
              </h3>
              <table>
                <thead>
                  <tr>
                    <th>{labels.field}</th>
                    <th>{labels.before}</th>
                    <th>{labels.after}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.diff.map((d) => (
                    <tr key={d.path}>
                      <td className="mono">{d.path}</td>
                      <td className="mono neg">{show(d.before)}</td>
                      <td className="mono" style={{ color: 'var(--success)' }}>
                        {show(d.after)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview.valid && preview.diff.length > 0 ? (
            <ActionForm action={publishConfig}>
              <input type="hidden" name="config" value={text} />
              <label>
                {labels.notes}
                <input name="notes" maxLength={500} />
              </label>
              <label className="check">
                <input type="checkbox" name="confirm" /> {labels.confirm}
              </label>
              <div>
                <SubmitButton>{labels.publish}</SubmitButton>
              </div>
            </ActionForm>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
