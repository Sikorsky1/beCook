import { CheckboxItem } from "becook";

export const Unchecked = () => (
  <CheckboxItem checked={false} label="Tomates cherry 250g" onChange={() => {}} />
);

export const Checked = () => (
  <CheckboxItem checked={true} label="Tomates cherry 250g" onChange={() => {}} strikeWhenChecked />
);

export const WithMeta = () => (
  <CheckboxItem
    checked={false}
    label="Aceite de oliva"
    onChange={() => {}}
    meta={<span>Para 4 personas</span>}
    valueBadge="500 ml"
  />
);
