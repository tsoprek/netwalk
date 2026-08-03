import { useContext } from "react";
import {
  ConsolesContext,
  type ConsolesContextValue,
} from "./ConsolesContextCore";

export function useConsoles(): ConsolesContextValue {
  const c = useContext(ConsolesContext);
  if (!c) throw new Error("ConsolesProvider missing");
  return c;
}
