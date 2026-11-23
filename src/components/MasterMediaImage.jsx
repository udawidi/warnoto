import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient.js";
import { masterMediaRef } from "../lib/masterMedia.js";

// Read the original field through the signed-in user's RLS policy. Keep the
// result on the mounted image only, outside shared master data and localStorage.
export function MasterMediaImage({ src, loading, ...props }) {
  const element = useRef(null);
  const [loaded, setLoaded] = useState(null);
  const deferred = Boolean(masterMediaRef(src));
  useEffect(() => {
    const media = masterMediaRef(src);
    if (!media || !supabase) return;
    const controller = new AbortController();
    const failed = () => {
      if (controller.signal.aborted) return;
      setLoaded({ ref: src, failed: true });
      element.current?.dispatchEvent(new Event("error"));
    };
    const load = async () => {
      try {
        const { data, error } = await supabase.from(media.table).select(`image:data->>${media.field}`).eq("id", media.id).abortSignal(controller.signal).maybeSingle();
        if (error || !data?.image) failed();
        else if (!controller.signal.aborted) setLoaded({ ref: src, image: data.image });
      } catch { failed(); }
    };
    let observer;
    if (loading === "lazy" && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void load(); }
      }, { rootMargin: "200px" });
      observer.observe(element.current);
    } else { void load(); }
    return () => { observer?.disconnect(); controller.abort(); };
  }, [src, loading]);
  const result = loaded?.ref === src ? loaded : null;
  return <img {...props} ref={element} loading={loading} title={result?.failed ? "Gambar belum dapat dimuat" : props.title} src={deferred ? result?.image : src} />;
}
