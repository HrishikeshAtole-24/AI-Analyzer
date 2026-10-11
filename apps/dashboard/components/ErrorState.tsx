import styles from './ErrorState.module.css';

export function ErrorState({ title, message }: { title: string; message: string }) {
  return (
    <div className={styles.box} role="alert">
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className={styles.empty}>{children}</div>;
}
