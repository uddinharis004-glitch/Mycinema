import { useState, useRef, useCallback, useEffect } from "react";
import Plyr from "plyr";
import "plyr/dist/plyr.css";

/* ═══════════════════════════════════════════════════════
   PASSCODE — change VITE_PASSCODE in Vercel env vars
   or it defaults to 7989
═══════════════════════════════════════════════════════ */
const PASSCODE = import.meta.env.VITE_PASSCODE || "7989";

/* ═══════════════════════════════════════════════════════
   PASSCODE MODAL
═══════════════════════════════════════════════════════ */
function PasscodeModal({ onSuccess, onCancel }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);
  const inputRef = useRef();

  useEffect(() => { inputRef.current?.focus(); }, []);

  const check = () => {
    if (code === PASSCODE) {
      onSuccess();
    } else {
      setError(true);
      setShake(true);
      setCode("");
      setTimeout(() => { setError(false); setShake(false); }, 1000);
    }
  };

  return (
    <div
      onClick={onCancel}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.88)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background:"#12141B", border:`1px solid ${error ? "rgba(239,68,68,.4)" : "rgba(255,255,255,.1)"}`, borderRadius:18, padding:"36px 32px", width:300, textAlign:"center", transition:"border-color .2s", animation: shake ? "shake .4s ease" : "none" }}
      >
        <div style={{ fontSize:38, marginBottom:14 }}>🔒</div>
        <div style={{ fontSize:17, fontWeight:700, color:"#F5F5F5", marginBottom:6 }}>Enter Passcode</div>
        <div style={{ fontSize:13, color:"#6B7280", marginBottom:22 }}>Required to upload or delete videos</div>

        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && check()}
          placeholder="••••"
          maxLength={10}
          style={{ width:"100%", background:"rgba(255,255,255,.06)", border:`1px solid ${error ? "#EF4444" : "rgba(255,255,255,.15)"}`, borderRadius:10, padding:"12px 14px", color:"#F5F5F5", fontSize:22, textAlign:"center", letterSpacing:"6px", boxSizing:"border-box", fontFamily:"inherit", transition:"border-color .2s" }}
        />

        {error && (
          <div style={{ color:"#EF4444", fontSize:13, marginTop:10, fontWeight:500 }}>
            ❌ Wrong passcode — try again
          </div>
        )}

        <div style={{ display:"flex", gap:10, marginTop:20 }}>
          <button
            onClick={onCancel}
            style={{ flex:1, background:"rgba(255,255,255,.07)", border:"1px solid rgba(255,255,255,.12)", color:"#9CA3AF", padding:"11px", borderRadius:9, cursor:"pointer", fontSize:14, fontFamily:"inherit", fontWeight:500 }}
          >Cancel</button>
          <button
            onClick={check}
            style={{ flex:1, background:"linear-gradient(135deg,#F59E0B,#EF4444)", border:"none", color:"#000", fontWeight:700, padding:"11px", borderRadius:9, cursor:"pointer", fontSize:14, fontFamily:"inherit" }}
          >Unlock</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   API CALLS
═══════════════════════════════════════════════════════ */
const api = {
  async listVideos() {
    const res = await fetch("/api/videos");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load videos");
    return data.videos || [];
  },
  async getUploadUrl(filename, contentType) {
    const res = await fetch("/api/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, contentType }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to get upload URL");
    return data;
  },
  async deleteVideo(key) {
    const res = await fetch("/api/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (!res.ok) throw new Error("Failed to delete");
  },
};

/* ═══════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════ */
function uploadToR2(signedUrl, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.send(file);
  });
}

async function generateThumbnailBlob(file) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.muted = true; video.playsInline = true; video.preload = "metadata";
    const timeout = setTimeout(() => { URL.revokeObjectURL(url); resolve(null); }, 10000);
    video.onloadedmetadata = () => { video.currentTime = Math.min(5, video.duration * 0.1) || 1; };
    video.onseeked = () => {
      clearTimeout(timeout); URL.revokeObjectURL(url);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 640; canvas.height = 360;
        canvas.getContext("2d").drawImage(video, 0, 0, 640, 360);
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.82);
      } catch { resolve(null); }
    };
    video.onerror = () => { clearTimeout(timeout); URL.revokeObjectURL(url); resolve(null); };
    video.src = url;
  });
}

const fmtSize = (b) => {
  if (!b) return "";
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${(b / 1e3).toFixed(0)} KB`;
};
const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/* ═══════════════════════════════════════════════════════
   PLAYER PICKER MODAL
═══════════════════════════════════════════════════════ */
function PlayerPicker({ video, onPlayInBrowser, onClose }) {
  const [copied, setCopied] = useState(false);
  const isAndroid = /android/i.test(navigator.userAgent);
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  const url = video.url;
  const encoded = encodeURIComponent(url);

  const intentUrl = (pkg) => {
    try {
      const u = new URL(url);
      return `intent://${u.host}${u.pathname}#Intent;scheme=https;package=${pkg};type=video/mp4;end`;
    } catch { return url; }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { prompt("Copy this link:", url); }
  };

  const download = () => {
    const a = document.createElement("a");
    a.href = url; a.download = video.title; a.target = "_blank"; a.click();
  };

  const options = [
    { icon:"▶", label:"Play in Browser", sub:"Plyr player — works for MP4", color:"#F59E0B", action:() => { onPlayInBrowser(video); onClose(); }, show:true },
    { icon:"🟠", label:"Open in VLC", sub: isAndroid ? "VLC for Android — MKV + dual audio + subtitles" : isIOS ? "VLC for iOS — MKV support" : "Desktop VLC — full MKV support", color:"#FF7700", action:() => { window.location.href = `vlc://${url}`; }, show:true },
    { icon:"🎬", label:"Open in MX Player", sub:"MX Player — MKV + dual audio + subtitles", color:"#E91E63", action:() => { window.location.href = intentUrl("com.mxtech.videoplayer.ad"); }, show:isAndroid },
    { icon:"🎬", label:"Open in MX Player Pro", sub:"MX Player Pro for Android", color:"#C2185B", action:() => { window.location.href = intentUrl("com.mxtech.videoplayer.pro"); }, show:isAndroid },
    { icon:"▶", label:"Open in Just Player", sub:"Just Player — lightweight MKV player", color:"#7C3AED", action:() => { window.location.href = intentUrl("com.brouken.player"); }, show:isAndroid },
    { icon:"🔥", label:"Open in Infuse", sub:"Infuse — MKV + subtitles on iOS/Apple TV", color:"#3B82F6", action:() => { window.location.href = `infuse://x-callback-url/play?url=${encoded}`; }, show:isIOS },
    { icon:"▶", label:"Open in nPlayer", sub:"nPlayer — MKV + subtitles on iOS", color:"#06B6D4", action:() => { window.location.href = `nplayer-${url}`; }, show:isIOS },
    { icon: copied ? "✅" : "📋", label: copied ? "Copied!" : "Copy Video Link", sub:"Paste into any player app", color:"#10B981", action:copyLink, show:true },
    { icon:"⬇", label:"Download", sub:"Save file to your device", color:"#6366F1", action:download, show:true },
  ].filter((o) => o.show);

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.88)", zIndex:1500, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background:"#12141B", border:"1px solid rgba(255,255,255,.1)", borderRadius:18, width:"100%", maxWidth:420, overflow:"hidden", boxShadow:"0 24px 64px rgba(0,0,0,.8)" }}>
        <div style={{ padding:"20px 22px 14px", borderBottom:"1px solid rgba(255,255,255,.07)" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:15, fontWeight:700, color:"#F5F5F5", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{video.title}</div>
              <div style={{ fontSize:12, color:"#6B7280", marginTop:4 }}>Choose how to play</div>
            </div>
            <button onClick={onClose} style={{ background:"rgba(255,255,255,.08)", border:"1px solid rgba(255,255,255,.12)", color:"#9CA3AF", width:30, height:30, borderRadius:"50%", cursor:"pointer", fontSize:14, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginLeft:12, fontFamily:"inherit" }}>✕</button>
          </div>
        </div>
        <div style={{ padding:"10px 22px", borderBottom:"1px solid rgba(255,255,255,.05)", background:"rgba(255,255,255,.02)" }}>
          <span style={{ fontSize:11, color:"#6B7280" }}>{isAndroid ? "📱 Android detected" : isIOS ? "📱 iOS detected" : "💻 Desktop detected"} — showing compatible players</span>
        </div>
        <div style={{ padding:"8px 0" }}>
          {options.map((opt, i) => (
            <button key={i} onClick={opt.action}
              style={{ width:"100%", display:"flex", alignItems:"center", gap:14, padding:"13px 22px", background:"transparent", border:"none", borderBottom: i < options.length-1 ? "1px solid rgba(255,255,255,.04)" : "none", cursor:"pointer", textAlign:"left", fontFamily:"inherit" }}
              onMouseEnter={(e) => e.currentTarget.style.background="rgba(255,255,255,.04)"}
              onMouseLeave={(e) => e.currentTarget.style.background="transparent"}
            >
              <div style={{ width:38, height:38, borderRadius:10, background:`${opt.color}22`, border:`1px solid ${opt.color}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{opt.icon}</div>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:14, fontWeight:600, color:"#E8EAF2" }}>{opt.label}</div>
                <div style={{ fontSize:11, color:"#6B7280", marginTop:2 }}>{opt.sub}</div>
              </div>
              <div style={{ marginLeft:"auto", color:"#4B5563", fontSize:14, flexShrink:0 }}>›</div>
            </button>
          ))}
        </div>
        <div style={{ padding:"12px 22px", borderTop:"1px solid rgba(255,255,255,.06)", background:"rgba(245,158,11,.04)" }}>
          <div style={{ fontSize:11, color:"#9CA3AF", lineHeight:1.6 }}>💡 <strong style={{ color:"#F59E0B" }}>MKV tip:</strong> Use VLC or MX Player for full MKV support — dual audio, subtitles, all formats.</div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   PLYR VIDEO PLAYER
═══════════════════════════════════════════════════════ */
function Player({ video, onClose }) {
  const videoRef = useRef();
  const playerRef = useRef();
  const [audioTracks, setAudioTracks] = useState([]);
  const [activeTrack, setActiveTrack] = useState(0);
  const [showAudioMenu, setShowAudioMenu] = useState(false);

  useEffect(() => {
    if (!videoRef.current) return;
    playerRef.current = new Plyr(videoRef.current, {
      controls: ["play-large","rewind","play","fast-forward","progress","current-time","duration","mute","volume","settings","pip","fullscreen"],
      settings: ["speed"],
      speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
      tooltips: { controls: true, seek: true },
    });

    const vid = videoRef.current;
    const checkTracks = () => {
      if (vid.audioTracks && vid.audioTracks.length > 0) {
        const tracks = Array.from(vid.audioTracks).map((t, i) => ({
          id: i,
          label: t.label || t.language || `Track ${i + 1}`,
        }));
        setAudioTracks(tracks);
      }
    };
    vid.addEventListener("loadedmetadata", checkTracks);
    vid.addEventListener("canplay", checkTracks);

    return () => {
      playerRef.current?.destroy();
      vid.removeEventListener("loadedmetadata", checkTracks);
      vid.removeEventListener("canplay", checkTracks);
    };
  }, []);

  const switchTrack = (index) => {
    const vid = videoRef.current;
    if (!vid?.audioTracks) return;
    for (let i = 0; i < vid.audioTracks.length; i++) {
      vid.audioTracks[i].enabled = i === index;
    }
    setActiveTrack(index);
    setShowAudioMenu(false);
  };

  useEffect(() => {
    const h = (e) => {
      if (e.key === "Escape") {
        if (showAudioMenu) setShowAudioMenu(false);
        else onClose();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, showAudioMenu]);

  return (
    <div
      onClick={() => { if (showAudioMenu) setShowAudioMenu(false); else onClose(); }}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.97)", zIndex:1000, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:20 }}
    >
      <div style={{ width:"100%", maxWidth:980 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, gap:12 }}>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:18, fontWeight:700, color:"#F5F5F5", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{video.title}</div>
            <div style={{ fontSize:11, color:"#6B7280", marginTop:3 }}>
              {fmtSize(video.size)}{video.uploadedAt ? ` · ${fmtDate(video.uploadedAt)}` : ""}
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
            {audioTracks.length > 1 && (
              <div style={{ position:"relative" }}>
                <button
                  onClick={() => setShowAudioMenu(!showAudioMenu)}
                  style={{ background: showAudioMenu ? "rgba(245,158,11,.2)" : "rgba(255,255,255,.1)", border:`1px solid ${showAudioMenu ? "rgba(245,158,11,.5)" : "rgba(255,255,255,.2)"}`, color: showAudioMenu ? "#F59E0B" : "#fff", padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:600, fontFamily:"inherit", display:"flex", alignItems:"center", gap:6 }}
                >
                  🎵 {audioTracks[activeTrack]?.label || `Track ${activeTrack + 1}`}
                </button>
                {showAudioMenu && (
                  <div style={{ position:"absolute", right:0, top:"calc(100% + 8px)", background:"#1B1D28", border:"1px solid rgba(255,255,255,.12)", borderRadius:10, overflow:"hidden", minWidth:180, zIndex:100, boxShadow:"0 8px 32px rgba(0,0,0,.7)" }}>
                    <div style={{ padding:"8px 14px 6px", fontSize:11, color:"#6B7280", fontWeight:600, letterSpacing:".5px" }}>AUDIO TRACK</div>
                    {audioTracks.map((track, i) => (
                      <button key={i} onClick={() => switchTrack(i)}
                        style={{ display:"flex", alignItems:"center", gap:10, width:"100%", padding:"10px 16px", background: activeTrack===i ? "rgba(245,158,11,.12)" : "transparent", border:"none", borderBottom: i < audioTracks.length-1 ? "1px solid rgba(255,255,255,.06)" : "none", color: activeTrack===i ? "#F59E0B" : "#E8EAF2", fontSize:13, cursor:"pointer", fontFamily:"inherit", textAlign:"left" }}>
                        <span style={{ fontSize:8, color: activeTrack===i ? "#F59E0B" : "transparent" }}>●</span>
                        {track.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button onClick={onClose}
              style={{ background:"rgba(255,255,255,.1)", border:"1px solid rgba(255,255,255,.2)", color:"#fff", width:36, height:36, borderRadius:"50%", cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"inherit" }}>✕</button>
          </div>
        </div>
        <video ref={videoRef} poster={video.thumbnail || ""} playsInline crossOrigin="anonymous">
          <source src={video.url} />
        </video>
        <div style={{ marginTop:8, textAlign:"right", fontSize:11, color:"#374151" }}>Press Esc to close</div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   VIDEO CARD
═══════════════════════════════════════════════════════ */
function VideoCard({ video, onPlay, onDelete, onConfirmedDelete }) {
  const [hovered, setHovered] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e) => {
    e.stopPropagation();
    setDeleting(true);
    await onConfirmedDelete(video);
    setDeleting(false);
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setConfirmDel(false); }}
      style={{ background:"#12141B", borderRadius:12, overflow:"hidden", border:`1px solid ${hovered ? "rgba(245,158,11,.5)" : "rgba(255,255,255,.07)"}`, cursor:"pointer", transition:"transform .18s ease, border-color .18s ease, box-shadow .18s ease", transform: hovered ? "translateY(-4px) scale(1.015)" : "none", boxShadow: hovered ? "0 16px 40px rgba(0,0,0,.6)" : "none" }}
    >
      <div style={{ position:"relative", paddingTop:"56.25%", background:"#1B1D28", overflow:"hidden" }} onClick={() => onPlay(video)}>
        {video.thumbnail
          ? <img src={video.thumbnail} alt={video.title} style={{ position:"absolute", top:0, left:0, width:"100%", height:"100%", objectFit:"cover", transition:"transform .3s ease", transform: hovered ? "scale(1.06)" : "scale(1)" }} />
          : <div style={{ position:"absolute", top:0, left:0, width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:40, background:"linear-gradient(135deg,#1B1D28,#252945)" }}>🎬</div>
        }
        <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,.48)", display:"flex", alignItems:"center", justifyContent:"center", opacity: hovered ? 1 : 0, transition:"opacity .18s" }}>
          <div style={{ width:58, height:58, borderRadius:"50%", background:"rgba(245,158,11,.92)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, paddingLeft:4, boxShadow:"0 4px 28px rgba(245,158,11,.55)" }}>▶</div>
        </div>
      </div>
      <div style={{ padding:"12px 14px" }}>
        <div title={video.title} style={{ fontSize:14, fontWeight:600, color:"#E8EAF2", marginBottom:6, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{video.title}</div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", fontSize:11, color:"#6B7280" }}>
          <span>{fmtSize(video.size)}{video.uploadedAt ? ` · ${fmtDate(video.uploadedAt)}` : ""}</span>
          {confirmDel
            ? <div style={{ display:"flex", gap:5 }}>
                <button onClick={handleDelete} disabled={deleting}
                  style={{ background:"rgba(239,68,68,.15)", border:"1px solid rgba(239,68,68,.4)", color:"#EF4444", fontSize:11, padding:"2px 8px", borderRadius:4, cursor:"pointer", fontFamily:"inherit" }}>
                  {deleting ? "…" : "Delete"}
                </button>
                <button onClick={(e) => { e.stopPropagation(); setConfirmDel(false); }}
                  style={{ background:"rgba(255,255,255,.07)", border:"1px solid rgba(255,255,255,.1)", color:"#9CA3AF", fontSize:11, padding:"2px 8px", borderRadius:4, cursor:"pointer", fontFamily:"inherit" }}>
                  Cancel
                </button>
              </div>
            : <button
                onClick={(e) => { e.stopPropagation(); onDelete(video, () => setConfirmDel(true)); }}
                style={{ background:"transparent", border:"none", color:"#6B7280", cursor:"pointer", fontSize:14, padding:"1px 4px", fontFamily:"inherit" }}>
                🗑
              </button>
          }
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   UPLOAD PANEL
═══════════════════════════════════════════════════════ */
function UploadPanel({ onDone }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [thumbPreview, setThumbPreview] = useState(null);
  const [thumbBlob, setThumbBlob] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [phase, setPhase] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const fileRef = useRef();

  const handleFile = useCallback(async (f) => {
    if (!/\.(mp4|mkv|avi|mov|webm|wmv|m4v|flv)$/i.test(f.name) && !f.type.startsWith("video/")) {
      setError("Please select a video file (MP4, MKV, MOV, AVI, WebM…)"); return;
    }
    setError(null); setFile(f);
    setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
    setPhase("generating");
    const blob = await generateThumbnailBlob(f);
    if (blob) { setThumbBlob(blob); setThumbPreview(URL.createObjectURL(blob)); }
    setPhase("");
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const upload = async () => {
    if (!file || !title.trim()) return;
    setUploading(true); setError(null); setProgress(0);
    try {
      const ext = file.name.split(".").pop().toLowerCase();
      const safeTitle = title.trim().replace(/[^a-zA-Z0-9 ._-]/g, "").replace(/ /g, "-");
      const filename = `${safeTitle}.${ext}`;
      setPhase("video");
      const { url: videoUrl } = await api.getUploadUrl(filename, file.type || "video/mp4");
      await uploadToR2(videoUrl, file, setProgress);
      if (thumbBlob) {
        setPhase("thumb"); setProgress(0);
        const { url: thumbUrl } = await api.getUploadUrl(filename.replace(/\.[^.]+$/, ".jpg"), "image/jpeg");
        await uploadToR2(thumbUrl, thumbBlob, setProgress);
      }
      setPhase("done");
      setTimeout(() => {
        setFile(null); setTitle(""); setThumbPreview(null); setThumbBlob(null);
        setUploading(false); setProgress(0); setPhase("");
        onDone();
      }, 1200);
    } catch (e) {
      setError(e.message); setUploading(false); setPhase("");
    }
  };

  const phaseLabel = { video:"Uploading video to R2…", thumb:"Uploading thumbnail…", done:"✅ Upload complete!", generating:"Generating thumbnail…" };

  return (
    <div style={{ maxWidth:660, margin:"0 auto" }}>
      {!file ? (
        <div onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onClick={() => fileRef.current?.click()}
          style={{ border:`2px dashed ${dragging ? "#F59E0B" : "rgba(255,255,255,.13)"}`, borderRadius:18, padding:"80px 40px", textAlign:"center", background:dragging?"rgba(245,158,11,.04)":"rgba(255,255,255,.01)", transition:"all .15s", cursor:"pointer" }}>
          <div style={{ fontSize:56, marginBottom:18 }}>📤</div>
          <div style={{ fontSize:22, fontWeight:800, color:"#F5F5F5", marginBottom:10 }}>{dragging ? "Release to upload" : "Upload a Video"}</div>
          <div style={{ fontSize:14, color:"#6B7280", lineHeight:1.8, marginBottom:28 }}>
            Drag & drop or click to browse<br/>MP4, MKV, MOV, AVI, WebM · Uploads directly to <strong style={{ color:"#9CA3AF" }}>Cloudflare R2</strong>
          </div>
          <button onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
            style={{ background:"linear-gradient(135deg,#F59E0B,#EF4444)", border:"none", color:"#000", fontWeight:700, padding:"10px 28px", borderRadius:9, cursor:"pointer", fontSize:14, fontFamily:"inherit" }}>Browse Files</button>
          {error && <div style={{ marginTop:16, fontSize:13, color:"#EF4444" }}>⚠️ {error}</div>}
        </div>
      ) : (
        <div style={{ background:"#12141B", borderRadius:16, padding:28, border:"1px solid rgba(255,255,255,.08)" }}>
          {thumbPreview && (
            <div style={{ width:"100%", aspectRatio:"16/9", borderRadius:10, overflow:"hidden", marginBottom:20, background:"#1B1D28" }}>
              <img src={thumbPreview} alt="thumbnail" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
            </div>
          )}
          {phase === "generating" && !thumbPreview && (
            <div style={{ width:"100%", aspectRatio:"16/9", borderRadius:10, background:"#1B1D28", display:"flex", alignItems:"center", justifyContent:"center", marginBottom:20, color:"#6B7280", fontSize:13 }}>
              <span className="spin" style={{ marginRight:8 }}>⚙️</span> Generating thumbnail…
            </div>
          )}
          <label style={{ display:"block", fontSize:11, color:"#9CA3AF", marginBottom:6, fontWeight:600, letterSpacing:".5px" }}>TITLE</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={uploading} placeholder="Enter a title"
            style={{ width:"100%", background:"rgba(255,255,255,.06)", border:"1px solid rgba(255,255,255,.1)", borderRadius:8, padding:"10px 14px", color:"#E8EAF2", fontSize:15, marginBottom:16, boxSizing:"border-box", fontFamily:"inherit" }} />
          <div style={{ fontSize:12, color:"#6B7280", marginBottom:20 }}>📁 {file.name} &nbsp;·&nbsp; {fmtSize(file.size)}</div>
          {uploading && (
            <div style={{ marginBottom:20 }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"#9CA3AF", marginBottom:6 }}>
                <span>{phaseLabel[phase] || "Preparing…"}</span><span>{progress}%</span>
              </div>
              <div style={{ height:6, background:"rgba(255,255,255,.08)", borderRadius:3, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${progress}%`, background:"linear-gradient(90deg,#F59E0B,#EF4444)", borderRadius:3, transition:"width .2s ease" }} />
              </div>
            </div>
          )}
          {error && <div style={{ color:"#EF4444", fontSize:13, marginBottom:16 }}>⚠️ {error}</div>}
          <div style={{ display:"flex", gap:12 }}>
            <button onClick={upload} disabled={uploading || !title.trim()}
              style={{ flex:1, background:phase==="done"?"rgba(16,185,129,.9)":"linear-gradient(135deg,#F59E0B,#EF4444)", border:"none", color:"#000", fontWeight:700, fontSize:14, padding:11, borderRadius:9, cursor:uploading||!title.trim()?"not-allowed":"pointer", opacity:uploading||!title.trim()?.7:1, fontFamily:"inherit" }}>
              {uploading ? (phase==="done" ? "✅ Done!" : "Uploading…") : "⬆ Upload to R2"}
            </button>
            {!uploading && (
              <button onClick={() => { setFile(null); setTitle(""); setThumbPreview(null); setThumbBlob(null); setError(null); }}
                style={{ background:"rgba(255,255,255,.07)", border:"1px solid rgba(255,255,255,.12)", color:"#9CA3AF", fontSize:14, padding:"11px 20px", borderRadius:9, cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
            )}
          </div>
        </div>
      )}
      <input ref={fileRef} type="file" accept="video/*,.mkv,.avi,.wmv,.flv,.m4v" style={{ display:"none" }}
        onChange={(e) => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ""; }} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════════════ */
export default function CineVault() {
  const [view, setView] = useState("library");
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [pickerVideo, setPickerVideo] = useState(null);
  const [search, setSearch] = useState("");

  // Auth state
  const [isAuthed, setIsAuthed] = useState(false);
  const [showPasscode, setShowPasscode] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  // Require passcode before running an action
  const requireAuth = useCallback((action) => {
    if (isAuthed) {
      action();
    } else {
      setPendingAction(() => action);
      setShowPasscode(true);
    }
  }, [isAuthed]);

  const onPasscodeSuccess = () => {
    setIsAuthed(true);
    setShowPasscode(false);
    if (pendingAction) {
      pendingAction();
      setPendingAction(null);
    }
  };

  const onPasscodeCancel = () => {
    setShowPasscode(false);
    setPendingAction(null);
  };

  const loadVideos = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const vids = await api.listVideos();
      setVideos(vids);
    } catch (e) { setLoadError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadVideos(); }, [loadVideos]);

  // Delete handler — first arg is video, second is a callback to show confirm
  const handleDeleteRequest = (video, showConfirm) => {
    requireAuth(showConfirm);
  };

  const handleDelete = async (video) => {
    try {
      await api.deleteVideo(video.key);
      const thumbKey = video.key.replace(/\.[^.]+$/, ".jpg");
      await api.deleteVideo(thumbKey).catch(() => {});
      setVideos((prev) => prev.filter((v) => v.id !== video.id));
    } catch (e) { alert("Delete failed: " + e.message); }
  };

  const handleUploadDone = () => {
    setView("library");
    loadVideos();
  };

  const filtered = search
    ? videos.filter((v) => v.title.toLowerCase().includes(search.toLowerCase()))
    : videos;

  return (
    <div style={{ minHeight:"100vh", background:"#09090E", color:"#E8EAF2", fontFamily:"Inter,system-ui,sans-serif" }}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:6px;background:#13141C}::-webkit-scrollbar-thumb{background:#2A2D3A;border-radius:4px}
        ::placeholder{color:#4B5563}
        input:focus{outline:none;border-color:rgba(245,158,11,.5)!important;box-shadow:0 0 0 3px rgba(245,158,11,.09)}
        button{font-family:inherit}
        :root{--plyr-color-main:#F59E0B;--plyr-video-background:#000;--plyr-range-fill-background:#F59E0B;--plyr-control-radius:6px}
        .plyr{border-radius:10px;overflow:hidden}
        @keyframes spin{to{transform:rotate(360deg)}}.spin{animation:spin .8s linear infinite;display:inline-block}
        @keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}.fade{animation:fade .22s ease}
        @keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}
      `}</style>

      {/* PASSCODE MODAL */}
      {showPasscode && <PasscodeModal onSuccess={onPasscodeSuccess} onCancel={onPasscodeCancel} />}

      {/* HEADER */}
      <header style={{ position:"sticky", top:0, zIndex:50, background:"rgba(9,9,14,.93)", backdropFilter:"blur(18px)", borderBottom:"1px solid rgba(255,255,255,.07)" }}>
        <div style={{ maxWidth:1300, margin:"0 auto", padding:"0 24px", height:62, display:"flex", alignItems:"center", justifyContent:"space-between", gap:16 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
            <div style={{ width:34, height:34, borderRadius:8, background:"linear-gradient(135deg,#F59E0B,#EF4444)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:17 }}>🎬</div>
            <span style={{ fontSize:18, fontWeight:700, letterSpacing:"-.4px" }}>Cine<span style={{ color:"#F59E0B" }}>Vault</span></span>
          </div>

          <div style={{ display:"flex", gap:3, background:"rgba(255,255,255,.06)", borderRadius:9, padding:3 }}>
            <button onClick={() => setView("library")}
              style={{ padding:"5px 20px", borderRadius:7, border:"none", cursor:"pointer", fontSize:13, fontWeight:600, background:view==="library"?"rgba(245,158,11,.88)":"transparent", color:view==="library"?"#000":"#9CA3AF", transition:"all .15s" }}>
              📽 Library
            </button>
            {/* Upload tab requires passcode */}
            <button onClick={() => requireAuth(() => setView("upload"))}
              style={{ padding:"5px 20px", borderRadius:7, border:"none", cursor:"pointer", fontSize:13, fontWeight:600, background:view==="upload"?"rgba(245,158,11,.88)":"transparent", color:view==="upload"?"#000":"#9CA3AF", transition:"all .15s", display:"flex", alignItems:"center", gap:6 }}>
              {isAuthed ? "⬆" : "🔒"} Upload
            </button>
          </div>

          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            {view === "library" && videos.length > 0 && (
              <input type="text" placeholder="🔍  Search…" value={search} onChange={(e) => setSearch(e.target.value)}
                style={{ background:"rgba(255,255,255,.06)", border:"1px solid rgba(255,255,255,.1)", borderRadius:8, padding:"7px 12px", color:"#E8EAF2", fontSize:13, width:180 }} />
            )}
            {view === "library" && !loading && (
              <span style={{ fontSize:12, color:"#6B7280", whiteSpace:"nowrap" }}>
                {filtered.length} video{filtered.length !== 1 ? "s" : ""}
              </span>
            )}
            <button onClick={loadVideos} title="Refresh"
              style={{ background:"rgba(255,255,255,.06)", border:"1px solid rgba(255,255,255,.1)", color:"#9CA3AF", width:32, height:32, borderRadius:8, cursor:"pointer", fontSize:14, display:"flex", alignItems:"center", justifyContent:"center" }}>↻</button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth:1300, margin:"0 auto", padding:"32px 24px" }}>

        {/* LIBRARY */}
        {view === "library" && (
          <div className="fade">
            {loading && (
              <div style={{ textAlign:"center", padding:"80px 0" }}>
                <div className="spin" style={{ fontSize:32, marginBottom:16 }}>⚙️</div>
                <div style={{ fontSize:14, color:"#6B7280" }}>Loading your library…</div>
              </div>
            )}
            {!loading && loadError && (
              <div style={{ textAlign:"center", padding:"80px 0" }}>
                <div style={{ fontSize:40, marginBottom:16 }}>⚠️</div>
                <div style={{ fontSize:16, fontWeight:600, color:"#F5F5F5", marginBottom:8 }}>Couldn't connect to R2</div>
                <div style={{ fontSize:13, color:"#EF4444", marginBottom:20, maxWidth:480, margin:"0 auto 20px" }}>{loadError}</div>
                <button onClick={loadVideos} style={{ background:"rgba(245,158,11,.9)", border:"none", color:"#000", fontWeight:700, padding:"8px 22px", borderRadius:8, cursor:"pointer", fontFamily:"inherit" }}>Retry</button>
              </div>
            )}
            {!loading && !loadError && videos.length === 0 && (
              <div style={{ textAlign:"center", padding:"80px 0" }}>
                <div style={{ fontSize:60, marginBottom:20 }}>🎞️</div>
                <div style={{ fontSize:22, fontWeight:800, color:"#F5F5F5", marginBottom:10 }}>No videos yet</div>
                <div style={{ fontSize:14, color:"#6B7280", marginBottom:28 }}>Upload your first video to get started</div>
                <button onClick={() => requireAuth(() => setView("upload"))}
                  style={{ background:"linear-gradient(135deg,#F59E0B,#EF4444)", border:"none", color:"#000", fontWeight:700, padding:"10px 28px", borderRadius:9, cursor:"pointer", fontSize:14, fontFamily:"inherit" }}>
                  🔒 Upload First Video
                </button>
              </div>
            )}
            {!loading && !loadError && filtered.length > 0 && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))", gap:20 }}>
                {filtered.map((v) => (
                  <VideoCard
                    key={v.id}
                    video={v}
                    onPlay={setPickerVideo}
                    onDelete={(video, showConfirm) => handleDeleteRequest(video, showConfirm)}
                    onConfirmedDelete={handleDelete}
                  />
                ))}
              </div>
            )}
            {!loading && !loadError && search && filtered.length === 0 && (
              <div style={{ textAlign:"center", padding:"60px 0", color:"#6B7280" }}>
                <div style={{ fontSize:36, marginBottom:14 }}>🔍</div>
                <div style={{ fontWeight:600, color:"#E8EAF2" }}>No results for "{search}"</div>
              </div>
            )}
          </div>
        )}

        {/* UPLOAD */}
        {view === "upload" && (
          <div className="fade">
            <div style={{ textAlign:"center", marginBottom:32 }}>
              <div style={{ fontSize:16, fontWeight:700, color:"#F5F5F5", marginBottom:6 }}>Upload to Cloudflare R2</div>
              <div style={{ fontSize:13, color:"#6B7280" }}>Videos appear in your library the moment the upload finishes</div>
            </div>
            <UploadPanel onDone={handleUploadDone} />
          </div>
        )}
      </main>

      {pickerVideo && (
        <PlayerPicker
          video={pickerVideo}
          onPlayInBrowser={setPlaying}
          onClose={() => setPickerVideo(null)}
        />
      )}
      {playing && <Player video={playing} onClose={() => setPlaying(null)} />}
    </div>
  );
}
