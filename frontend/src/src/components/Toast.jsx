import { useEffect } from "react";
import { useStore, useDispatch } from "../useStore";

export default function Toast() {
  const { toast } = useStore();
  const dispatch = useDispatch();

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => dispatch({ type: "HIDE_TOAST" }), 3000);
    return () => clearTimeout(timer);
  }, [toast, dispatch]);

  if (!toast) return null;

  const className = ["visible", toast.type].filter(Boolean).join(" ");

  return (
    <div id="toast" className={className}>
      {toast.message}
    </div>
  );
}