import { useEffect, useState } from "react";

export const GUIDE_DEMO_EVENT = "skylab:guide-demo";

export default function useGuideDemo(guideId) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const handleGuideDemo = (event) => {
      if (event.detail?.guideId !== guideId) return;
      setActive(event.detail.active === true);
    };

    window.addEventListener(GUIDE_DEMO_EVENT, handleGuideDemo);
    return () => {
      window.removeEventListener(GUIDE_DEMO_EVENT, handleGuideDemo);
    };
  }, [guideId]);

  return active;
}
