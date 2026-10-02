import { createContext, useContext, useEffect } from "react";

export const WorkspaceInfoContext = createContext(null);

// The LoRA guide keeps the project’s current learning-rate comparison without
// coupling the shared header to project loading or training.
export function useLoraInfo(learningRate) {
  const setLearningRate = useContext(WorkspaceInfoContext);
  useEffect(() => { setLearningRate?.(learningRate); }, [setLearningRate, learningRate]);
}
