// Step 34: the result of the user's last action on a page (Compra, Despensa). One notice at a time:
// - a new action clears the previous notice as soon as it starts;
// - the result of an action is only shown while it is still the last action with a notice (a slow
//   success never replaces the notice of a later action);
// - a failure (refused, conflict, not in the pantry…) is always shown when it arrives, even after
//   later actions: the user has to know that the change did not happen;
// - an action without a notice of its own (marking an item) clears the text but never drops an
//   answer still on its way;
// - closing a form clears the notice it showed and drops its pending success;
// - reset() (another identity or week) drops everything, failures included.

export type NoticeOrigin = "list" | "form";
export type ActionNotice = { text: string; origin: NoticeOrigin } | null;

type SetNotice = (update: (current: ActionNotice) => ActionNotice) => void;

export function createActionNotices(setNotice: SetNotice) {
  let latest = 0;
  let latestOrigin: NoticeOrigin | null = null;
  let epoch = 0;

  return {
    // Starts an action: returns how to show its result.
    begin(origin: NoticeOrigin = "list") {
      const id = ++latest;
      const startedIn = epoch;
      latestOrigin = origin;
      setNotice(() => null);
      return (text: string, { failed = false }: { failed?: boolean } = {}) => {
        if (startedIn !== epoch) return;
        if (id === latest || failed) setNotice(() => (text ? { text, origin } : null));
      };
    },
    // An action without a notice of its own (marking an item, «Tengo / Se acabó»…).
    clear() {
      setNotice(() => null);
    },
    // A form closes: its notice goes away, and so does a success it is still waiting for.
    close(origin: NoticeOrigin) {
      if (latestOrigin === origin) {
        latest++;
        latestOrigin = null;
      }
      setNotice((current) => (current?.origin === origin ? null : current));
    },
    // Another identity or week: nothing of the previous one is shown.
    reset() {
      epoch++;
      latest++;
      latestOrigin = null;
      setNotice(() => null);
    },
  };
}

export const noticeText = (notice: ActionNotice, origin: NoticeOrigin) =>
  notice?.origin === origin ? notice.text : "";
