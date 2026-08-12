import { cloneElement, useId, type ReactElement, type ReactNode } from 'react';

interface FieldControlProps {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
}

interface FieldProps {
  label: string;
  description?: string;
  error?: string;
  children: ReactElement<FieldControlProps>;
  hint?: ReactNode;
}

export function Field({ label, description, error, children, hint }: FieldProps) {
  const generatedId = useId();
  const controlId = children.props.id ?? `${generatedId}-control`;
  const descriptionId = description ? `${generatedId}-description` : undefined;
  const errorId = error ? `${generatedId}-error` : undefined;
  const describedBy = [children.props['aria-describedby'], descriptionId, errorId]
    .filter(Boolean)
    .join(' ') || undefined;

  return (
    <div className="field">
      <div className="field__label-row">
        <label htmlFor={controlId}>{label}</label>
        {hint ? <span className="field__hint">{hint}</span> : null}
      </div>
      {cloneElement(children, {
        id: controlId,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : children.props['aria-invalid'],
      })}
      {description ? <p id={descriptionId} className="field__description">{description}</p> : null}
      {error ? <p id={errorId} className="field__error">{error}</p> : null}
    </div>
  );
}
