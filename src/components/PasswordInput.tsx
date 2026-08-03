import { forwardRef, useState, type ComponentPropsWithoutRef } from "react";
import NotesIcon from "./NotesIcon";

type PasswordInputProps = Omit<ComponentPropsWithoutRef<"input">, "type">;

/** Standard ConneCat password field with an accessible reveal control. */
const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { className = "", disabled, style, ...props },
  ref,
) {
  const [visible, setVisible] = useState(false);

  return (
    <span className="password-input">
      <input
        {...props}
        ref={ref}
        type={visible ? "text" : "password"}
        disabled={disabled}
        className={`password-input__field ${className}`.trim()}
        style={{ ...style, paddingRight: 40 }}
      />
      <button
        type="button"
        className={`password-input__toggle${visible ? " password-input__toggle--visible" : ""}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setVisible((current) => !current)}
        disabled={disabled}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        title={visible ? "Hide password" : "Show password"}
      >
        <NotesIcon name="preview" size={17} />
      </button>
    </span>
  );
});

export default PasswordInput;
