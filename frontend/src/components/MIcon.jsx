export default function MIcon({ name, size = 20, className, filled = false, ...rest }) {
  return (
    <span
      className={`${filled ? "material-icons" : "material-icons-outlined"}${className ? ` ${className}` : ""}`}
      style={{ fontSize: size, lineHeight: 1 }}
      aria-hidden="true"
      {...rest}
    >
      {name}
    </span>
  );
}
