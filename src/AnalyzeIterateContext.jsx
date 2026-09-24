import { createContext, useContext, useState } from "react";
import { useDispatch } from "./useStore";
import PromptIterationDialog from "./components/PromptIterationDialog";
import SceneIterationDialog from "./components/SceneIterationDialog";
import "./components/AnalyzeIterate.css";

const Context = createContext(null);
export function AnalyzeIterateProvider({ children }) {
  const [target, setTarget] = useState(null), dispatch = useDispatch();
  const [promptPreferences, setPromptPreferences] = useState({});
  const close = () => setTarget(null);
  return <Context.Provider value={{ prompts: () => setTarget({ kind: "prompts" }), image: image => setTarget({ kind: "image", image }) }}>
    {children}
    {target?.kind === "prompts" && <PromptIterationDialog onClose={close} preferences={promptPreferences} onPreferences={setPromptPreferences} />}
    {target?.kind === "image" && <SceneIterationDialog image={target.image} onClose={close} onOpenScene={id => {
      dispatch({ type: "OPEN_ITERATIVE_SCENE", payload: id }); close();
    }} />}
  </Context.Provider>;
}
export function useAnalyzeIterate() { return useContext(Context); }
