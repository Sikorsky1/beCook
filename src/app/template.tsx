export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ animation: "page-enter 280ms ease-out both" }}>
      {children}
    </div>
  );
}
