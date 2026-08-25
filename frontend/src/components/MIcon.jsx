export default function MIcon({ name, size = 20, className, ...rest }) {
  return (
    <span
      className={`material-icons-outlined${className ? ` ${className}` : ""}`}
      style={{ fontSize: size, lineHeight: 1 }}
      aria-hidden="true"
      {...rest}
    >
      {name}
    </span>
  );
}

