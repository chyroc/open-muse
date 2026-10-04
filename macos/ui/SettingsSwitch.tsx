import type { ReactNode } from "react";

// An on/off settings row. The label wraps the switch, so the whole row toggles it.
export function Switch({
  label,
  detail,
  icon,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  detail?: string;
  // An app icon at the start of the row.
  icon?: ReactNode;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      className={`settings-row settings-switch-row${icon ? " connector-row" : ""}`}
    >
      {icon}
      <div>
        <strong>{label}</strong>
        {detail && <p>{detail}</p>}
      </div>
      <input
        type="checkbox"
        role="switch"
        className="settings-switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </label>
  );
}
