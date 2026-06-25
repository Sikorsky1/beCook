import { StickyPageHeader } from "becook";

export const WithTitle = () => (
  <div style={{ position: "relative", minHeight: "80px" }}>
    <StickyPageHeader title="Semana actual" heading="Mi menú semanal" />
  </div>
);

export const WithAction = () => (
  <div style={{ position: "relative", minHeight: "80px" }}>
    <StickyPageHeader
      title="Lista de la compra"
      heading="Ingredientes"
      action={
        <button
          style={{
            fontSize: "0.75rem",
            color: "var(--accent)",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontWeight: 600,
            padding: "4px 8px",
          }}
        >
          Compartir
        </button>
      }
    />
  </div>
);
