import { Card } from "becook";

export const Default = () => (
  <Card style={{ padding: "1.25rem", maxWidth: "300px" }}>
    <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem", fontWeight: 600, color: "var(--foreground)" }}>
      Lunes
    </h3>
    <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--muted-foreground)" }}>
      Ensalada mediterránea · Pollo al horno
    </p>
  </Card>
);

export const Minimal = () => (
  <Card style={{ padding: "1rem", maxWidth: "260px" }}>
    <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--foreground)" }}>
      Contenido de la tarjeta
    </p>
  </Card>
);
