// Step 34: the result of the user's last action on a page (Compra, Despensa). One notice at a time:
// - a new action clears the previous notice as soon as it starts;
// - the result of an action is only shown while it is still the last one (a slow answer never
//   replaces the notice of a later action);
// - closing a form clears the notice it showed, and an answer still on its way is dropped.

export type NoticeOrigin = "list" | "form";
export type ActionNotice = { text: string; origin: NoticeOrigin } | null;

type SetNotice = (update: (current: ActionNotice) => ActionNotice) => void;

export function createActionNotices(setNotice: SetNotice) {
  let latest = 0;
  let latestOrigin: NoticeOrigin | null = null;

  return {
    // Starts an action: returns how to show its result.
    begin(origin: NoticeOrigin = "list") {
      const id = ++latest;
      latestOrigin = origin;
      setNotice(() => null);
      return (text: string) => {
        if (id === latest) setNotice(() => (text ? { text, origin } : null));
      };
    },
    // An action without a notice of its own (marking an item, «Tengo / Se acabó»…).
    clear() {
      latest++;
      latestOrigin = null;
      setNotice(() => null);
    },
    // A form closes: its notice goes away, and so does an answer it is still waiting for.
    close(origin: NoticeOrigin) {
      if (latestOrigin === origin) {
        latest++;
        latestOrigin = null;
      }
      setNotice((current) => (current?.origin === origin ? null : current));
    },
  };
}

export const noticeText = (notice: ActionNotice, origin: NoticeOrigin) =>
  notice?.origin === origin ? notice.text : "";
