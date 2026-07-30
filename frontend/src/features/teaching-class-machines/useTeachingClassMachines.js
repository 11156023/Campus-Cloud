import { useCallback, useEffect, useRef, useState } from "react";
import { TeachingClassesService } from "../../services/teachingClasses";

export function useTeachingClassMachines(classId, { enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled || !classId) return null;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError("");
    try {
      const result = await TeachingClassesService.studentMachines(classId);
      if (
        requestId === requestIdRef.current
        && String(result?.class_id) === String(classId)
      ) {
        setData(result);
      }
      return result;
    } catch (reason) {
      if (requestId === requestIdRef.current) {
        setError(reason?.message ?? "無法讀取學生機器狀態");
      }
      return null;
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [classId, enabled]);

  useEffect(() => {
    requestIdRef.current += 1;
    setData(null);
    setError("");
    setLoading(Boolean(enabled && classId));
  }, [classId, enabled]);

  useEffect(() => {
    if (enabled && classId) refresh();
  }, [classId, enabled, refresh]);

  return { data, error, loading, refresh };
}
