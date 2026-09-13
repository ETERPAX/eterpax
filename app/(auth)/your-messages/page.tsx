"use client";
import EterpaxLetterEditor from "@/components/EterpaxLetterEditor.tsx/EterpaxLetterEditor";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  MessageCircle,
  Video,
  Mic,
  Image as ImageIcon,
  FileText,
} from "lucide-react";
import { OnboardingFormLayout } from "@/components/auth/OnboardingFormLayout";

type SavedMessage = {
  id: string;
  recipient_name: string;
  recipient_email: string;
  body: string;
  status: string;
  created_at: string;
  document_path?: string | null;
  voice_path?: string | null;
  video_path?: string | null;
};

type RecordedVideo = {
  id: number;
  url: string;
  blob: Blob;
  filePath: string;
};

export default function YourMessagesPage() {
  const searchParams = useSearchParams();
  const messageId = searchParams.get("message");
  const isNewMessage =
  searchParams.get("new") === "true";
  /* =========================================================
     MESSAGE
  ========================================================= */

  const [recipient, setRecipient] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [message, setMessage] = useState("");

  const [savedMessages, setSavedMessages] = useState<SavedMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
 
  /* =========================================================
     POPUPS
  ========================================================= */

  const [showRecipientPopup, setShowRecipientPopup] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [showVideoOptions, setShowVideoOptions] = useState(false);
  const [showPhotoOptions, setShowPhotoOptions] = useState(false);

  const [showLetterEditor, setShowLetterEditor] = useState(false);

/* =========================================================
   LETTER EDITOR — SELECTION / FORMATTING
   ========================================================= */

const savedSelection = useRef<Range | null>(null);

/**
 * Save the exact text selection/caret position inside the editor.
 * This runs BEFORE a toolbar control takes focus.
 */
const saveLetterSelection = () => {
  const editor = document.getElementById("eterpax-letter-editor");

  if (!editor) return;

  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);

  if (!editor.contains(range.commonAncestorContainer)) return;

  savedSelection.current = range.cloneRange();
};

/**
 * Restore the selection/caret exactly where the user left it.
 */
const restoreLetterSelection = (): boolean => {
  const editor = document.getElementById("eterpax-letter-editor");

  if (!editor || !savedSelection.current) return false;

  const selection = window.getSelection();

  if (!selection) return false;

  try {
    selection.removeAllRanges();
    selection.addRange(savedSelection.current);

    return true;
  } catch {
    return false;
  }
};

/**
 * Apply formatting without losing the user's selection/caret.
 */
const formatLetter = (
  command: string,
  value: string = ""
) => {
  const editor = document.getElementById("eterpax-letter-editor");

  if (!editor) return;

  /*
   * Restore the exact selection BEFORE executing the command.
   */ if (!restoreLetterSelection()) return;

  

  /*
   * Keep formatting as CSS instead of old HTML tags where possible.
   */
  try {
    document.execCommand(
      "styleWithCSS",
      false,
      "true"
    );
  } catch {
    // Some browsers may not support styleWithCSS.
  }

  /*
   * Execute the formatting command.
   */
  document.execCommand(
    command,
    false,
    value
  );

  /*
   * Save the resulting selection/caret again.
   * This is important so the next toolbar action
   * starts from the current position.
   */
  const selection = window.getSelection();

  if (
    selection &&
    selection.rangeCount > 0 &&
    editor.contains(selection.getRangeAt(0).commonAncestorContainer)
  ) {
    savedSelection.current =
      selection.getRangeAt(0).cloneRange();
  }
};

/**
 * FONT
 */
const changeLetterFont = (font: string) => {
  formatLetter("fontName", font);
};

/**
 * SIZE
 *
 * The browser's execCommand fontSize uses values 1–7.
 * We translate our UI sizes into those values and then
 * convert the resulting element to the desired CSS size.
 */
const changeLetterSize = (size: string) => {
  const commandSize = size;

  formatLetter("fontSize", commandSize);

  /*
   * Convert the browser-generated <font size="...">
   * into an actual CSS font-size.
   */
  const editor = document.getElementById(
    "eterpax-letter-editor"
  );

  if (!editor) return;
/*
const fonts = editor.querySelectorAll("font[size]");
...
});
*/ 
 
};
/**
 * COLOR
 */
const changeLetterColor = (color: string) => {
  formatLetter("foreColor", color);
};

const [letterSaved, setLetterSaved] = useState(false);


  /* =========================================================
     DOCUMENTS
  ========================================================= */

  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [documentPath, setDocumentPath] = useState<string | null>(null);
  const [existingDocumentPaths, setExistingDocumentPaths] = useState<string[]>([]);
  const [documentsToDelete, setDocumentsToDelete] = useState<string[]>([]);
  /* =========================================================
     VOICE
  ========================================================= */

  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);

  const [isVoiceRecording, setIsVoiceRecording] = useState(false);

  const [recordedVoice, setRecordedVoice] =
    useState<string | null>(null);

  const [recordedVoiceBlob, setRecordedVoiceBlob] =
    useState<Blob | null>(null);

  const [recordedVoicePath, setRecordedVoicePath] =
    useState<string | null>(null);
    const [removedVoice, setRemovedVoice] = useState(false);
    const [removedVoicePath, setRemovedVoicePath] = useState<string | null>(null);
  const voiceRecorderRef =
    useRef<MediaRecorder | null>(null);

  const voiceStreamRef =
    useRef<MediaStream | null>(null);

  const voiceChunksRef =
    useRef<Blob[]>([]);

  /* =========================================================
     VIDEO
  ========================================================= */

  const [showVideoRecorder, setShowVideoRecorder] =
    useState(false);

  const [isRecording, setIsRecording] =
    useState(false);

    const [recordedVideo, setRecordedVideo] =
    useState<RecordedVideo | null>(null);
    const [existingVideoUrl, setExistingVideoUrl] = useState<string | null>(null);
    const [existingVideoPath, setExistingVideoPath] = useState<string | null>(null);
    const [removedExistingVideo, setRemovedExistingVideo] = useState(false);
  const videoPreviewRef =
    useRef<HTMLVideoElement | null>(null);

  
    const cameraStreamRef =
  useRef<MediaStream | null>(null);

  const videoRecorderRef =
    useRef<MediaRecorder | null>(null);

  const videoChunksRef =
    useRef<Blob[]>([]);

  /* =========================================================
     PHOTOS
  ========================================================= */

  const [showPhotoCamera, setShowPhotoCamera] =
    useState(false);

  const [photoFiles, setPhotoFiles] =
    useState<File[]>([]);

  const [photoPreviewUrls, setPhotoPreviewUrls] =
    useState<string[]>([]);
    const [existingPhotoUrls, setExistingPhotoUrls] =
  useState<string[]>([]);
  const [existingPhotoPaths, setExistingPhotoPaths] = useState<string[]>([]);
  const [removedPhotoPaths, setRemovedPhotoPaths] = useState<string[]>([]);
  const photoVideoRef =
    useRef<HTMLVideoElement | null>(null);

  

  /* =========================================================
     LOAD MESSAGE
  ========================================================= */

  useEffect(() => {
    const loadMessages = async () => {
      setLoadingMessages(true);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        console.error(
          "NO SE ENCONTRÓ EL USUARIO:",
          userError
        );

        setLoadingMessages(false);
        return;
      }

      /* EDIT MODE */

      if (messageId) {
        const { data, error } = await supabase
          .from("messages")
          .select(
            `
              id,
              recipient_name,
              recipient_email,
              body,
              status,
              created_at,
              document_path,
              voice_path,
              video_path
            `
          )
          .eq("id", messageId)
          .eq("user_id", user.id)
          .single();

        if (error) {
          console.error(
            "ERROR LOADING MESSAGE:",
            error
          );

          setLoadingMessages(false);
          return;
        }

        setRecipient(data.recipient_name ?? "");
        setRecipientEmail(data.recipient_email ?? "");
        setMessage(data.body ?? "");
        setLetterSaved(Boolean(data.body));
        setDocumentPath(data.document_path ?? null);
        const {
          data: existingDocuments,
          error: existingDocumentsError,
        } = await supabase
          .from("message_documents")
          .select("document_path")
          .eq("message_id", messageId)
          .eq("user_id", user.id)
          .order("created_at", { ascending: true });
        
        if (existingDocumentsError) {
          console.error(
            "ERROR LOADING MESSAGE DOCUMENTS:",
            existingDocumentsError
          );
        } else {
          setExistingDocumentPaths(
            (existingDocuments ?? []).map(
              (document) => document.document_path
            )
          );
        }
        setRecordedVoicePath(data.voice_path ?? null);
        const { data: existingVideos, error: existingVideosError } =
  await supabase
    .from("message_videos")
    .select("video_path")
    .eq("message_id", messageId)
    .order("created_at", { ascending: true });

if (existingVideosError) {
  console.error(
    "ERROR LOADING MESSAGE VIDEOS:",
    existingVideosError
  );
} else if (existingVideos?.length) {
  const { data: videoUrlData, error: videoUrlError } =
    await supabase.storage
      .from("message-videos")
      .createSignedUrl(existingVideos[0].video_path, 3600);

  if (videoUrlError) {
    console.error(
      "ERROR CREATING VIDEO URL:",
      videoUrlError
    );
  } else {
    setExistingVideoUrl(videoUrlData.signedUrl);
    setExistingVideoPath(data.video_path);
  }
}
        if (data.voice_path) {
          const { data: voiceUrlData, error: voiceUrlError } =
            await supabase.storage
            .from("message-audio")
              .createSignedUrl(data.voice_path, 3600);
        
          if (voiceUrlError) {
            console.error("ERROR CREATING VOICE URL:", voiceUrlError);
          } else {
            setRecordedVoice(voiceUrlData.signedUrl);
          }
        }
        const { data: existingPhotos, error: existingPhotosError } =
        await supabase
          .from("message_photos")
          .select("storage_path")
          .eq("message_id", messageId)
          .order("sort_order", { ascending: true });
      
      if (existingPhotosError) {
        console.error(
          "ERROR LOADING MESSAGE PHOTOS:",
          JSON.stringify(
            existingPhotosError,
            Object.getOwnPropertyNames(existingPhotosError)
          )
        );
      } else if (existingPhotos?.length) {
        const signedPhotos = await Promise.all(
          existingPhotos.map(async (photo) => {
            const { data, error } = await supabase.storage
              .from("message-photos")
              .createSignedUrl(photo.storage_path, 3600);
      
            if (error) {
              console.error("ERROR CREATING PHOTO URL:", error);
              return null;
            }
      
            return data.signedUrl;
          })
        );
      
        setExistingPhotoUrls(
          signedPhotos.filter((url): url is string => Boolean(url))
        );
        setExistingPhotoPaths(
          existingPhotos.map((photo) => photo.storage_path)
        );
      }
        setSavedMessages([data]);

        setLoadingMessages(false);

        return;
      }

      /* CREATE MODE */

      const { data, error } = await supabase
        .from("messages")
        .select(
          `
            id,
            recipient_name,
            recipient_email,
            body,
            status,
            created_at,
            document_path,
            voice_path,
            video_path
          `
        )
        .eq("user_id", user.id)
        .order("created_at", {
          ascending: false,
        });

      if (error) {
        console.error(
          "ERROR LOADING MESSAGES:",
          error
        );

        setLoadingMessages(false);
        return;
      }
      if (messageId) {
      const { data: existingPhotos, error: existingPhotosError } =
      await supabase
        .from("message_photos")
        .select("storage_path")
        .eq("message_id", messageId)
        .order("sort_order", { ascending: true });
    
    if (existingPhotosError) {
      console.error(
        "ERROR LOADING MESSAGE PHOTOS:",
        JSON.stringify(
          existingPhotosError,
          Object.getOwnPropertyNames(existingPhotosError)
        )
      );
    } else if (existingPhotos?.length) {
      const signedPhotos = await Promise.all(
        existingPhotos.map(async (photo) => {
          const { data, error } = await supabase.storage
            .from("message-photos")
            .createSignedUrl(photo.storage_path, 3600);
    
          if (error) {
            console.error("ERROR CREATING PHOTO URL:", error);
            return null;
          }
    
          return data.signedUrl;
        })
      );
    
      setExistingPhotoUrls(
        signedPhotos.filter((url): url is string => Boolean(url))
      );
    }
    }
      setSavedMessages(data ?? []);

      setLoadingMessages(false);
    };

    loadMessages();
  }, [messageId]);

  /* =========================================================
     VIDEO CAMERA
     ========================================================= */
     const startCamera = async () => {
      try {
        console.log("CAMERA: SOLICITANDO CAMARA...");
    
        if (
          !navigator.mediaDevices ||
          !navigator.mediaDevices.getUserMedia
        ) {
          alert("Your browser does not support camera access.");
          return null;
        }
    
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: {
              ideal: 1280,
            },
            height: {
              ideal: 720,
            },
          },
          audio: false,
        });
    
        return stream;
      } catch (error) {
        console.error("CAMERA: ERROR AL ACCEDER A LA CAMARA", error);
        alert("Unable to access the camera.");
        return null;
      }
    };
  const startVideoCamera = async () => {
    try {
      console.log("VIDEO: SOLICITANDO CAMARA...");

      

      const stream = await startCamera();

if (!stream) {
  return;
}

cameraStreamRef.current = stream;

      const video =
        videoPreviewRef.current;

      if (!video) {
        console.error(
          "VIDEO: VIDEO ELEMENT NO ENCONTRADO"
        );

        stream
          .getTracks()
          .forEach((track) => track.stop());

          cameraStreamRef.current = null;

        return;
      }

      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;

      await video.play();

      console.log(
        "VIDEO: CAMARA ACTIVADA CORRECTAMENTE"
      );
    } catch (error) {
      console.error(
        "VIDEO: ERROR AL ABRIR CAMARA:",
        error
      );

      alert(
        `CAMERA ERROR: ${
          error instanceof DOMException
            ? `${error.name}: ${error.message}`
            : String(error)
        }`
      );
    }
  };
  const stopCamera = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current
        .getTracks()
        .forEach((track) => track.stop());
  
      cameraStreamRef.current = null;
    }
  };
  

  /* =========================================================
     OPEN / CLOSE VIDEO
     ========================================================= */

  useEffect(() => {
    if (!showVideoRecorder) {
      stopCamera();

      return;
    }

    const timer = window.setTimeout(() => {
      startVideoCamera();
    }, 100);

    return () => {
      window.clearTimeout(timer);
    };
  }, [showVideoRecorder]);

  const closeVideoRecorder = () => {
    if (isRecording) {
      const recorder =
        videoRecorderRef.current;

      if (
        recorder &&
        recorder.state !== "inactive"
      ) {
        recorder.stop();
      }

      setIsRecording(false);
    }

    stopCamera();

    setShowVideoRecorder(false);
  };

  /* =========================================================
     RECORD VIDEO
  ========================================================= */

  const handleVideoRecording = async () => {
    console.log("VIDEO: CLICK RECORD");
  
    if (isRecording) {
      const recorder = videoRecorderRef.current;
  
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
  
      setIsRecording(false);
      return;
    }
  
    let stream = cameraStreamRef.current;
  
    // If the camera is still initializing, wait for it.
    if (!stream || stream.getVideoTracks().every((track) => track.readyState !== "live")) {
      console.log("VIDEO: STREAM NO LISTO, INICIANDO CAMARA...");
  
      await startVideoCamera();
  
      stream = cameraStreamRef.current;
    }
  
    if (!stream) {
      console.error("VIDEO: NO HAY STREAM DESPUES DE INICIAR CAMARA");
      alert("The camera is not ready yet. Please wait a moment.");
      return;
    }
  
    const activeVideoTracks = stream
      .getVideoTracks()
      .filter((track) => track.readyState === "live");
  
    if (activeVideoTracks.length === 0) {
      console.error("VIDEO: NO HAY VIDEO TRACK ACTIVO");
      alert("The camera is not ready yet. Please wait a moment.");
      return;
    }
  
    try {
      videoChunksRef.current = [];
  
      const recorder = new MediaRecorder(stream);
  
      videoRecorderRef.current = recorder;
  
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          videoChunksRef.current.push(event.data);
        }
      };
  
      recorder.onstop = async () => {
        console.log("VIDEO: GRABACION TERMINADA");
  
        const blob = new Blob(videoChunksRef.current, {
          type: "video/webm",
        });
  
        if (blob.size === 0) {
          console.error("VIDEO: BLOB VACIO");
          return;
        }
  
        const url = URL.createObjectURL(blob);
  
        const {
          data: { user },
        } = await supabase.auth.getUser();
  
        if (!user) {
          console.error("VIDEO: USUARIO NO AUTENTICADO");
          return;
        }
  
        const fileName = `${Date.now()}.webm`;
        const filePath = `${user.id}/${fileName}`;
  
        console.log("VIDEO: SUBIENDO:", filePath);
  
        const { error: uploadError } = await supabase.storage
          .from("message-videos")
          .upload(filePath, blob, {
            contentType: "video/webm",
            upsert: false,
          });
  
        if (uploadError) {
          console.error("VIDEO UPLOAD ERROR:", uploadError);
          alert("Unable to upload the video.");
          return;
        }
  
        setRecordedVideo({
          
            id: Date.now(),
            url,
            blob,
            filePath,
          });
  
        videoChunksRef.current = [];
  
        console.log("VIDEO: GUARDADO CORRECTAMENTE");
      };
  
      recorder.start();
  
      setIsRecording(true);
  
      console.log("VIDEO: RECORDER STARTED");
    } catch (error) {
      console.error("VIDEO: ERROR RECORDER:", error);
    }
  };

  /* =========================================================
     PHOTO CAMERA
  ========================================================= */

  const startPhotoCamera = async () => {
    try {
      console.log(
        "PHOTO: SOLICITANDO CAMARA..."
      );

      if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        alert(
          "Your browser does not support camera access."
        );

        return;
      }

      const stream = await startCamera();

if (!stream) {
  return;
}

      cameraStreamRef.current =
        stream;

      const video =
        photoVideoRef.current;

      if (!video) {
        console.error(
          "PHOTO: VIDEO ELEMENT NO ENCONTRADO"
        );

        stream
          .getTracks()
          .forEach((track) => track.stop());

        cameraStreamRef.current =
          null;

        return;
      }

      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;

      await video.play();

      console.log(
        "PHOTO: CAMARA ACTIVADA CORRECTAMENTE"
      );
    } catch (error) {
      console.error(
        "PHOTO: ERROR AL ABRIR CAMARA:",
        error
      );

      alert(
        "ETERPAX could not access your camera. Please check your browser permissions."
      );
    }
  };

  const stopPhotoCamera = () => {
    console.log(
      "PHOTO: APAGANDO CAMARA..."
    );

    stopCamera();

    if (photoVideoRef.current) {
      photoVideoRef.current.pause();
      photoVideoRef.current.srcObject =
        null;
    }
  };

  useEffect(() => {
    if (!showPhotoCamera) {
      stopPhotoCamera();

      return;
    }

    const timer = window.setTimeout(() => {
      startPhotoCamera();
    }, 100);

    return () => {
      window.clearTimeout(timer);
    };
  }, [showPhotoCamera]);

  /* =========================================================
     TAKE PHOTO
  ========================================================= */

  const takePhoto = () => {
    console.log(
      "PHOTO: CLICK TAKE PHOTO"
    );

    const video =
      photoVideoRef.current;

    if (!video) {
      console.error(
        "PHOTO: VIDEO NO ENCONTRADO"
      );

      return;
    }

    if (
      !video.videoWidth ||
      !video.videoHeight
    ) {
      console.error(
        "PHOTO: VIDEO TODAVIA NO ESTA LISTO"
      );

      alert(
        "The camera is still loading. Please wait a moment."
      );

      return;
    }

    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      video.videoWidth;

    canvas.height =
      video.videoHeight;

    const context =
      canvas.getContext("2d");

    if (!context) {
      console.error(
        "PHOTO: NO SE PUDO CREAR CANVAS"
      );

      return;
    }

    context.drawImage(
      video,
      0,
      0,
      canvas.width,
      canvas.height
    );

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          console.error(
            "PHOTO: NO SE CREO BLOB"
          );

          return;
        }

        const file =
          new File(
            [blob],
            `eterpax-photo-${Date.now()}.jpg`,
            {
              type: "image/jpeg",
            }
          );

        const preview =
          URL.createObjectURL(blob);

        setPhotoFiles(
          (previous) => [
            ...previous,
            file,
          ]
        );

        setPhotoPreviewUrls(
          (previous) => [
            ...previous,
            preview,
          ]
        );

        console.log(
          "PHOTO: FOTO TOMADA:",
          file.name
        );
      },
      "image/jpeg",
      0.92
    );
  };

  const finishPhotoCamera = () => {
    stopPhotoCamera();
    setShowPhotoCamera(false);
  };

  /* =========================================================
     REMOVE PHOTO
  ========================================================= */

  const removePhoto = (
    index: number
  ) => {
    const preview =
      photoPreviewUrls[index];

    if (preview) {
      URL.revokeObjectURL(
        preview
      );
    }

    setPhotoFiles(
      (previous) =>
        previous.filter(
          (_, i) => i !== index
        )
    );

    setPhotoPreviewUrls(
      (previous) =>
        previous.filter(
          (_, i) => i !== index
        )
    );
  };

  /* =========================================================
     PHOTO UPLOAD FROM DEVICE
  ========================================================= */

  const handlePhotoUpload = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files =
      Array.from(
        event.target.files ?? []
      );

    if (!files.length) {
      return;
    }

    const urls =
      files.map((file) =>
        URL.createObjectURL(file)
      );

    setPhotoFiles(
      (previous) => [
        ...previous,
        ...files,
      ]
    );

    setPhotoPreviewUrls(
      (previous) => [
        ...previous,
        ...urls,
      ]
    );

    event.target.value = "";

    console.log(
      "PHOTO: ARCHIVOS SELECCIONADOS:",
      files.length
    );
  };

  /* =========================================================
     VOICE
  ========================================================= */

  const handleVoiceRecording =
    async () => {
      console.log(
        "VOICE: CLICK"
      );

      if (isVoiceRecording) {
        const recorder =
          voiceRecorderRef.current;

        if (
          recorder &&
          recorder.state !==
            "inactive"
        ) {
          recorder.stop();
        }

        return;
      }

      try {
        const stream =
          await navigator.mediaDevices.getUserMedia(
            {
              audio: true,
            }
          );

        voiceStreamRef.current =
          stream;

        voiceChunksRef.current = [];

        const recorder =
          new MediaRecorder(stream);

        voiceRecorderRef.current =
          recorder;

        recorder.ondataavailable =
          (event) => {
            if (
              event.data &&
              event.data.size > 0
            ) {
              voiceChunksRef.current.push(
                event.data
              );
            }
          };

        recorder.onstop = () => {
          const blob =
            new Blob(
              voiceChunksRef.current,
              {
                type: "audio/webm",
              }
            );

          if (blob.size === 0) {
            console.error(
              "VOICE: AUDIO VACIO"
            );

            return;
          }

          const url =
            URL.createObjectURL(
              blob
            );

          setRecordedVoiceBlob(
            blob
          );

          setRecordedVoice(
            url
          );

          setIsVoiceRecording(
            false
          );

          stream
            .getTracks()
            .forEach(
              (track) =>
                track.stop()
            );

          voiceStreamRef.current =
            null;

          voiceRecorderRef.current =
            null;

          console.log(
            "VOICE: GRABACION TERMINADA"
          );
        };

        recorder.start();

        setIsVoiceRecording(
          true
        );

        console.log(
          "VOICE: RECORDER STARTED"
        );
      } catch (error) {
        console.error(
          "VOICE: ERROR:",
          error
        );

        alert(
          "ETERPAX could not access your microphone."
        );
      }
    };

  const closeVoiceRecorder =
    () => {
      const recorder =
        voiceRecorderRef.current;

      if (
        recorder &&
        recorder.state !==
          "inactive"
      ) {
        recorder.stop();
      }

      if (
        voiceStreamRef.current
      ) {
        voiceStreamRef.current
          .getTracks()
          .forEach(
            (track) =>
              track.stop()
          );

        voiceStreamRef.current =
          null;
      }

      setIsVoiceRecording(
        false
      );

      setShowVoiceRecorder(
        false
      );
    };

  /* =========================================================
     CLEANUP ON PAGE UNMOUNT
  ========================================================= */

  useEffect(() => {
    return () => {
      stopCamera();
      stopPhotoCamera();

      if (
        voiceStreamRef.current
      ) {
        voiceStreamRef.current
          .getTracks()
          .forEach(
            (track) =>
              track.stop()
          );
      }

      photoPreviewUrls.forEach(
        (url) =>
          URL.revokeObjectURL(
            url
          )
      );

      if (recordedVoice) {
        URL.revokeObjectURL(
          recordedVoice
        );
      }

      if (recordedVideo) {
        URL.revokeObjectURL(recordedVideo.url);
      }
    };
  }, []);

  /* =========================================================
     SAVE MESSAGE
  ========================================================= */

  const saveMessage =
    async () => {
      if (!recipient.trim()) {
        alert(
          "Please enter the recipient's name."
        );

        return;
      }

      if (!recipientEmail.trim()) {
        alert(
          "Please enter the recipient's email."
        );

        return;
      }

      const {
        data: { user },
        error: userError,
      } =
        await supabase.auth.getUser();

      if (userError || !user) {
        alert(
          "There is no authenticated user."
        );

        return;
      }

      /* DOCUMENT */

      let uploadedDocumentPaths: string[] = [];
let uploadedDocumentPath = documentPath;

if (documentFiles.length > 0) {
  for (const [index, file] of documentFiles.entries()) {
    const filePath =
      `${user.id}/${Date.now()}-${index}-${file.name}`;

    const {
      error,
    } = await supabase.storage
      .from("message-documents")
      .upload(
        filePath,
        file,
        {
          upsert: false,
        }
      );

    if (error) {
      console.error(
        "DOCUMENT ERROR:",
        error
      );

      alert(
        "Unable to upload document."
      );

      return;
    }

    uploadedDocumentPaths.push(
      filePath
    );

    if (!uploadedDocumentPath) {
      uploadedDocumentPath =
        filePath;
    }
  }
}

      /* VOICE */

      let uploadedVoicePath =
        recordedVoicePath;

      if (recordedVoiceBlob) {
        const filePath =
          `${user.id}/${Date.now()}.webm`;

        const {
          error,
        } = await supabase.storage
          .from("message-audio")
          .upload(
            filePath,
            recordedVoiceBlob,
            {
              contentType:
                "audio/webm",
              upsert: false,
            }
          );

        if (error) {
          console.error(
            "VOICE UPLOAD ERROR:",
            error
          );

          alert(
            "Unable to upload voice message."
          );

          return;
        }

        uploadedVoicePath =
          filePath;
      }

      /* =====================================================
         CREATE / UPDATE MESSAGE
      ===================================================== */

      let currentMessageId =
        messageId;

      if (messageId) {
        const {
          error,
        } = await supabase
          .from("messages")
          .update({
            recipient_name:
              recipient.trim(),
            recipient_email:
              recipientEmail.trim(),
            body: message,
            ...(uploadedDocumentPath
              ? {
                  document_path:
                    uploadedDocumentPath,
                }
              : {}),
              ...(removedVoice && uploadedVoicePath === removedVoicePath
                ? {
                    voice_path: null,
                  }
                : uploadedVoicePath
                  ? {
                      voice_path: uploadedVoicePath,
                    }
                  : {}),
          })
          .eq("id", messageId)
          .eq("user_id", user.id);

        if (removedVoicePath) {
  const { error: deleteVoiceError } = await supabase.storage
    .from("message-audio")
    .remove([removedVoicePath]);

  if (deleteVoiceError) {
    console.error(
      "ERROR DELETING OLD VOICE:",
      deleteVoiceError
    );
  }
}
      } else {
        const {
          data,
          error,
        } = await supabase
          .from("messages")
          .insert({
            user_id: user.id,
            recipient_name:
              recipient.trim(),
            recipient_email:
              recipientEmail.trim(),
            body: message,
            status: "draft",
            document_path:
              uploadedDocumentPath,
            voice_path:
              uploadedVoicePath,
              video_path: recordedVideo?.filePath ?? null,
          })
          .select("id")
          .single();

        if (error) {
          console.error(
            "MESSAGE INSERT ERROR:",
            error
          );

          alert(
            error.message
          );

          return;
        }

        currentMessageId =
          data.id;
      }
      /* ============================================================
   SAVE DOCUMENT REFERENCES
============================================================ */

if (
  currentMessageId &&
  (uploadedDocumentPaths.length > 0 || documentsToDelete.length > 0)
) {
  if (documentsToDelete.length > 0) {
    const { error: deleteDocumentStorageError } = await supabase.storage
  .from("message-documents")
  .remove(documentsToDelete);

if (deleteDocumentStorageError) {
  console.error(
    "DOCUMENT STORAGE DELETE ERROR:",
    deleteDocumentStorageError
  );

  alert(deleteDocumentStorageError.message);

  return;
}
    const { error: deleteDocumentReferenceError } = await supabase
      .from("message_documents")
      .delete()
      .eq("message_id", currentMessageId)
      .in("document_path", documentsToDelete);
  
    if (deleteDocumentReferenceError) {
      console.error(
        "DOCUMENT REFERENCE DELETE ERROR:",
        deleteDocumentReferenceError
      );
  
      alert(
        `Unable to delete document references.\n\nMessage: ${deleteDocumentReferenceError.message}`
      );
  
      return;
    }
  }
  const documentRows =
    uploadedDocumentPaths.map(
      (path) => ({
        message_id:
          currentMessageId,
        user_id:
          user.id,
        document_path:
          path,
      })
    );

  const {
    error: documentReferenceError,
  } = await supabase
    .from("message_documents")
    .insert(documentRows);

  if (documentReferenceError) {
    console.error(
      "DOCUMENT REFERENCE ERROR:",
      {
        message: documentReferenceError.message,
        code: documentReferenceError.code,
        details: documentReferenceError.details,
        hint: documentReferenceError.hint,
      }
    );

    alert(
      `Document reference error:\n\n` +
      `Message: ${documentReferenceError.message}\n` +
      `Code: ${documentReferenceError.code}\n` +
      `Details: ${documentReferenceError.details}\n` +
      `Hint: ${documentReferenceError.hint}`
    );

    return;
  }
}

      /* =====================================================
         SAVE ALL VIDEOS
      ===================================================== */

      if (currentMessageId && (recordedVideo || removedExistingVideo)) {
        const { data: existingVideos, error: loadVideosError } = await supabase
  .from("message_videos")
  .select("video_path")
  .eq("message_id", currentMessageId);

if (loadVideosError) {
  console.error(
    "VIDEO LOAD ERROR:",
    loadVideosError
  );

  alert(loadVideosError.message);
  return;
}

const existingVideoPaths =
  existingVideos?.map((video) => video.video_path).filter(Boolean) ?? [];
  if (existingVideoPaths.length > 0) {
    const { error: deleteStorageError } = await supabase.storage
      .from("message-videos")
      .remove(existingVideoPaths);
  
    if (deleteStorageError) {
      console.error(
        "VIDEO STORAGE DELETE ERROR:",
        deleteStorageError
      );
  
      alert(deleteStorageError.message);
      return;
    }
  }
        const { error: deleteVideoError } = await supabase
  .from("message_videos")
  .delete()
  .eq("message_id", currentMessageId);

if (deleteVideoError) {
  console.error(
    "VIDEO DELETE ERROR:",
    deleteVideoError
  );

  alert(deleteVideoError.message);
  return;
}
if (recordedVideo) {
  const { error } = await supabase
    .from("message_videos")
    .insert({
      message_id: currentMessageId,
      user_id: user.id,
      video_path: recordedVideo.filePath,
    });

  if (error) {
    console.error(
      "VIDEO RECORD ERROR:",
      error
    );

    alert(
      error.message
    );

    return;
  }
}
      }

      /* =====================================================
         UPLOAD PHOTOS
      ===================================================== */
      if (currentMessageId && removedPhotoPaths.length > 0) {
        const { error: deletePhotoRowsError } = await supabase
          .from("message_photos")
          .delete()
          .eq("message_id", currentMessageId)
          .in("storage_path", removedPhotoPaths);
      
        if (deletePhotoRowsError) {
          console.error(
            "ERROR DELETING MESSAGE PHOTO ROWS:",
            deletePhotoRowsError
          );
        } else {
          const { error: deletePhotoStorageError } = await supabase.storage
            .from("message-photos")
            .remove(removedPhotoPaths);
      
          if (deletePhotoStorageError) {
            console.error(
              "ERROR DELETING MESSAGE PHOTO FILES:",
              deletePhotoStorageError
            );
          }
        }
      }
      if (
        currentMessageId &&
        photoFiles.length > 0
      ) {
        const photoRows: {
          message_id: string;
          user_id: string;
          storage_path: string;
        }[] = [];

        for (
          const file of photoFiles
        ) {
          const filePath =
            `${user.id}/${currentMessageId}/${Date.now()}-${file.name}`;

          const {
            error,
          } = await supabase.storage
            .from("message-photos")
            .upload(
              filePath,
              file,
              {
                contentType:
                  file.type ||
                  "image/jpeg",
                upsert: false,
              }
            );

          if (error) {
            console.error(
              "PHOTO UPLOAD ERROR:",
              error
            );

            alert(
              error.message
            );

            return;
          }

          photoRows.push({
            message_id:
              currentMessageId,
            user_id:
              user.id,
              storage_path: 
              filePath,
          });
        }
        console.log("PHOTO ROWS TO INSERT:", photoRows);
        if (
          photoRows.length > 0
        ) {
          const {
            error,
          } = await supabase
            .from(
              "message_photos"
            )
            .insert(
              photoRows
            );

          if (error) {
            console.error(
              "PHOTO DATABASE ERROR:",
              error
            );

            alert(
              error.message
            );

            return;
          }
        }
      }

      console.log(
        "ETERPAX: MENSAJE GUARDADO"
      );

      setShowRecipientPopup(
        false
      );

      window.location.href = `/review?message=${currentMessageId}`;
    };

  /* =========================================================
     RENDER
  ========================================================= */
  if (!messageId && !isNewMessage) {
    return (
      <OnboardingFormLayout
        step={5}
        totalSteps={5}
      >
        <div className="space-y-8">
  
          {/* BACK */}
          <Link
            href="/dashboard"
            className="inline-flex items-center text-sm font-medium text-neutral-500 transition hover:text-[#0A7BA8]"
          >
            ← Back to Dashboard
          </Link>
  
          {/* HEADER */}
          <div className="space-y-3 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#0F5C88]/10">
              <MessageCircle className="h-6 w-6 text-[#0F5C88]" />
            </div>
  
            <h1 className="text-5xl font-light tracking-tight text-[#0D2340]">
              Your Messages
            </h1>
  
            <p className="mx-auto max-w-lg text-lg leading-8 text-neutral-600">
              Your saved messages, ready whenever you need them.
            </p>
          </div>
  
          {/* MESSAGE LIST */}
          {loadingMessages ? (
            <div className="rounded-3xl bg-white p-8 text-center shadow-sm">
              <p className="text-sm text-neutral-500">
                Loading your messages...
              </p>
            </div>
          ) : savedMessages.length === 0 ? (
            <div className="rounded-3xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
              <h2 className="text-2xl font-light text-[#0D2340]">
                You haven't created a message yet.
              </h2>
  
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-neutral-500">
                Create your first message and choose what you want to preserve.
              </p>
  
              <Link
                href="/your-messages?new=true"
                className="mt-6 inline-flex items-center rounded-full bg-[#0A7BA8] px-8 py-4 font-medium text-white transition hover:bg-[#08698F]"
              >
                + New Message
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {savedMessages.map((savedMessage, index) => (
                <div
                  key={savedMessage.id}
                  className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm"
                >
                  <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
  
                    <div>
                      <p className="text-xs font-medium uppercase tracking-[0.2em] text-[#0A7BA8]">
                        Message {index + 1}
                      </p>
  
                      <h2 className="mt-2 text-2xl font-light text-[#0D2340]">
                        For {savedMessage.recipient_name}
                      </h2>
  
                      <p className="mt-1 text-sm text-neutral-500">
                        {savedMessage.recipient_email}
                      </p>
  
                      <p className="mt-3 text-xs text-neutral-400">
                        {new Date(
                          savedMessage.created_at
                        ).toLocaleDateString()}
                      </p>
                    </div>
  
                    <div className="flex flex-wrap gap-3">
                      <Link
                        href={`/review?message=${savedMessage.id}`}
                        className="inline-flex items-center rounded-full border border-[#0A7BA8] px-6 py-3 text-sm font-medium text-[#0A7BA8] transition hover:bg-[#0A7BA8]/5"
                      >
                        Preview
                      </Link>
  
                      <Link
                        href={`/your-messages?message=${savedMessage.id}`}
                        className="inline-flex items-center rounded-full bg-[#0A7BA8] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#08698F]"
                      >
                        Edit
                      </Link>
                    </div>
  
                  </div>
                </div>
              ))}
  
              {/* NEW MESSAGE */}
              <div className="flex justify-center pt-4">
                <Link
                  href="/your-messages?new=true"
                  className="inline-flex items-center rounded-full bg-[#0A7BA8] px-8 py-4 font-medium text-white transition hover:bg-[#08698F]"
                >
                  + New Message
                </Link>
              </div>
            </div>
          )}
  
        </div>
      </OnboardingFormLayout>
    );
  }
  return (
    <OnboardingFormLayout
      step={5}
      totalSteps={5}
    >
      <div className="space-y-7">

        {/* BACK */}

        <Link
          href="/dashboard"
          className="inline-flex items-center text-sm font-medium text-neutral-500 transition hover:text-[#0A7BA8]"
        >
          ← Back to Dashboard
        </Link>

        {/* HEADER */}

        <div className="space-y-3 text-center">

          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#0F5C88]/10">
            <MessageCircle className="h-6 w-6 text-[#0F5C88]" />
          </div>

          <h1 className="text-5xl font-light tracking-tight text-[#0D2340]">
            Create a Message
          </h1>

          <p className="mx-auto max-w-lg text-lg leading-8 text-neutral-600">
            Create something meaningful
            for someone you love.
          </p>

        </div>

        {/* RECIPIENT */}

        <div>
          <label className="mb-2 block text-sm font-medium text-white">
            Who is this message for?
          </label>

          <input
            type="text"
            placeholder="Full name"
            value={recipient}
            onChange={(e) =>
              setRecipient(
                e.target.value
              )
            }
            className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-4 text-[#0D2340] placeholder:text-neutral-400 outline-none transition focus:border-[#0A7BA8] focus:ring-2 focus:ring-[#0A7BA8]/20"
          />
        </div>

        {/* INFO */}

        <div className="rounded-2xl border border-[#0A7BA8]/20 bg-[#0A7BA8]/5 p-5">
          <p className="text-sm leading-6 text-[#17375E]">
            Your message remains private
            and protected until the
            conditions you choose are met.
          </p>
        </div>

        {/* CONTINUE */}

        <div className="flex justify-center pt-4">
          <button
            type="button"
            onClick={() => {
              if (!recipient.trim()) {
                alert(
                  "Please enter the recipient's name."
                );
                return;
              }

              setShowRecipientPopup(
                true
              );
            }}
            className="inline-flex items-center rounded-full bg-[#0A7BA8] px-10 py-4 font-medium text-white transition hover:bg-[#08698F]"
          >
            Continue →
          </button>
        </div>

      </div>

      {/* =====================================================
          RECIPIENT / CONTENT POPUP
      ===================================================== */}

      {showRecipientPopup && (
        <div className="fixed inset-0 z-[70]">

          <div
            className="absolute inset-0 bg-black/40"
            onClick={() =>
              setShowRecipientPopup(
                false
              )
            }
          />

          <div className="absolute inset-x-4 top-1/2 mx-auto max-h-[90vh] max-w-3xl -translate-y-1/2 overflow-y-auto rounded-[32px] bg-[#0F2747] p-6 shadow-2xl md:p-8">

            <div className="flex items-start justify-between">

              <div>
                <p className="text-xs font-medium tracking-[0.25em] text-white">
                  CREATE A MESSAGE
                </p>

                <h2 className="mt-2 text-3xl font-light tracking-tight text-white">
                  Create something meaningful.
                </h2>

                
              </div>

              <button
                type="button"
                onClick={() =>
                  setShowRecipientPopup(
                    false
                  )
                }
                className="text-sm font-medium text-white/70 hover:text-white"
              >
                Cancel
              </button>

            </div>

            {/* EMAIL */}

            <div className="mt-6">
              <label className="mb-2 block text-sm font-medium text-white/70">
                Email address
              </label>

              <input
                type="email"
                value={recipientEmail}
                onChange={(e) =>
                  setRecipientEmail(
                    e.target.value
                  )
                }
                placeholder="recipient@email.com"
                className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-4 text-[#0D2340] placeholder:text-neutral-400 outline-none transition focus:border-[#0A7BA8] focus:ring-2 focus:ring-[#0A7BA8]/20"
              />
            </div>

            {/* CONTENT */}

            <div className="mt-8">

              <p className="text-sm font-medium text-white/70">
                What would you like
                to leave?
              </p>

              <p className="mt-1 text-sm text-white/70">
                Choose one or more ways
                to make this message personal.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">

                {/* LETTER */}

                <button
                  type="button"
                  onClick={() => {
                    setShowLetterEditor(true);
                  }}
                  className="rounded-2xl border border-[#D9E4F2] bg-white p-5 text-left transition hover:border-[#0A7BA8] hover:bg-[#F8FCFE]"
                >
                  <div className="text-2xl">
  💌
</div>

                  <p className="mt-3 font-medium text-[#0F2747]">
                    Letter
                  </p>

                  <p className="mt-1 text-sm text-neutral-500">
  Words that should remain.
</p>

{letterSaved && (
  <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#0A7BA8]/10 px-3 py-1.5 text-xs font-medium text-[#0A7BA8]">
    ✉ Letter · 1
  </div>
)}
                </button>

                {/* VIDEO */}

                <button
                  type="button"
                  onClick={() => {
                    setShowVideoOptions(
                      false
                    );

                    setShowVideoRecorder(
                      true
                    );
                  }}
                  className="rounded-2xl border border-neutral-200 bg-white p-5 text-left transition hover:border-[#0A7BA8] hover:bg-[#F8FCFE]"
                >
                  <div className="text-2xl">
                    🎥
                  </div>

                  <p className="mt-3 font-medium text-[#0D2340]">
                    Video
                  </p>

                  <p className="mt-1 text-sm text-neutral-500">
                    Your presence. Your story.
                  </p>
                  {(recordedVideo || existingVideoUrl) && (
  <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#0A7BA8]/10 px-3 py-1.5 text-xs font-medium text-[#0A7BA8]">
    Video · 1
  </div>
)}
                </button>

                {/* VOICE */}

                <button
                  onClick={() => {
  setRemovedVoice(false);
  setShowVoiceRecorder(true);
}}
                  className="rounded-2xl border border-neutral-200 bg-white p-5 text-left transition hover:border-[#0A7BA8] hover:bg-[#F8FCFE]"
                >
                  <div className="text-2xl">
                    🎙
                  </div>

                  <p className="mt-3 font-medium text-[#0D2340]">
                    Voice
                  </p>

                  <p className="mt-1 text-sm text-neutral-500">
                    Something they can hear whenever they need it.
                  </p>
                  {recordedVoice && (
  <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#0A7BA8]/10 px-3 py-1.5 text-xs font-medium text-[#0A7BA8]">
    Voice · 1
  </div>
)}
                </button>

                {/* PHOTOS */}

                <button
                  type="button"
                  onClick={() =>
                    setShowPhotoOptions(
                      true
                    )
                  }
                  className="rounded-2xl border border-neutral-200 bg-white p-5 text-left transition hover:border-[#0A7BA8] hover:bg-[#F8FCFE]"
                >
                  <div className="text-2xl">
                    📷
                  </div>

                  <p className="mt-3 font-medium text-[#0D2340]">
                    Photos
                  </p>

                  <p className="mt-1 text-sm text-neutral-500">
                    Moments worth keeping.
                  </p>
                  {(existingPhotoUrls.length > 0 || photoFiles.length > 0) && (
  <span className="mt-2 inline-flex rounded-full bg-[#E8F6FB] px-2.5 py-1 text-xs font-medium text-[#0A7BA8]">
   Photos · {existingPhotoUrls.length + photoFiles.length}
  </span>
)}
                </button>

                {/* DOCUMENT */}

                <button
                  type="button"
                  onClick={() =>
                    document
                      .getElementById(
                        "document-upload"
                      )
                      ?.click()
                  }
                  className="rounded-2xl border border-neutral-200 bg-white p-5 text-left transition hover:border-[#0A7BA8] hover:bg-[#F8FCFE]"
                >
                  <div className="text-2xl">
                    📄
                  </div>

                  <p className="mt-3 font-medium text-[#0D2340]">
                    Documents
                  </p>

                  <p className="mt-1 text-sm text-neutral-500">
                    Important documents worth keeping secure.
                  </p>
                  {(documentFile || documentPath) && (
  <span className="mt-2 inline-flex rounded-full bg-[#E8F7FC] px-2 py-1 text-xs font-medium text-[#0A7BA8]">
    Document · 1
  </span>
)}
                </button>

              </div>
            </div>

            

            {/* DOCUMENT */}

            {(existingDocumentPaths.length > 0 || documentFiles.length > 0) && (
  <div className="mt-4 rounded-xl border border-[#0A7BA8]/20 bg-[#F8FCFE] px-4 py-3">
    <p className="text-sm font-medium text-[#0D2340]">
      Documents selected
    </p>

    <div className="mt-2 space-y-1">
    {existingDocumentPaths.map((path, index) => (
  <div
    key={`existing-${path}-${index}`}
    className="flex items-center justify-between gap-3"
  >
    <p className="text-xs text-neutral-500">
      {decodeURIComponent(
        path.split("/").pop() ?? path
      ).replace(/^\d+-\d+-/, "")}
    </p>

    <button
      type="button"
      onClick={() => {
        setDocumentsToDelete((previous) =>
          previous.includes(path)
            ? previous
            : [...previous, path]
        );

        setExistingDocumentPaths((previous) =>
          previous.filter(
            (existingPath) => existingPath !== path
          )
        );
      }}
      className="text-sm font-medium text-neutral-400 hover:text-red-500"
      aria-label="Remove document"
    >
      ×
    </button>
  </div>
))}

      {documentFiles.map((file, index) => (
        <p
          key={`${file.name}-${index}`}
          className="text-xs text-neutral-500"
        >
          {file.name}
        </p>
      ))}
    </div>
  </div>
)}

            

            {/* VIDEO RECORDER */}

            {showVideoRecorder && (
              <div className="mt-8 rounded-[24px] bg-[#0D2340] p-6">

                <div className="flex items-start justify-between">

                  <div>
                    <h2 className="text-2xl font-semibold text-white">
                      Create with ETERPAX
                    </h2>

                    <p className="mt-2 text-white/70">
                      Record a personal video message.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={
                      closeVideoRecorder
                    }
                    className="text-sm text-white/70 hover:text-white"
                  >
                    ✕
                  </button>

                </div>

                <div className="mt-6 overflow-hidden rounded-2xl bg-black">

                  <video
                    ref={
                      videoPreviewRef
                    }
                    autoPlay
                    playsInline
                    muted
                    className="aspect-video w-full object-cover"
                  />

                </div>

                <div className="mt-6 flex justify-center">

                  <button
                    type="button"
                    onClick={
                      handleVideoRecording
                    }
                    className="inline-flex items-center gap-3 rounded-full bg-[#0A7BA8] px-8 py-4 font-medium text-white"
                  >

                    <span
                      className={`h-3 w-3 rounded-full ${
                        isRecording
                          ? "animate-pulse bg-red-500"
                          : "bg-white"
                      }`}
                    />

                    {isRecording
                      ? "Stop Recording"
                      : "Start Recording"}

                  </button>

                </div>
                {existingVideoUrl && !recordedVideo && (
  <div className="mt-6">
  <div className="mb-2 flex items-center justify-between">
    <p className="text-sm text-white/70">
      Video already added
    </p>

    <button
      type="button"
      onClick={() => {
        setExistingVideoUrl(null);
        setRemovedExistingVideo(true);
      }}
      className="rounded-full bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/20"
    >
      ✕ Remove
    </button>
  </div>

  <video
    src={existingVideoUrl}
    controls
    className="w-full rounded-xl"
  />
</div>
)}
                {/* SAVED VIDEOS */}

                {recordedVideo && (
                  <div className="mt-6 space-y-4">

                    

                  </div>
                )}

              </div>
            )}

            {/* VOICE */}

            {showVoiceRecorder && (
              <div className="mt-8 rounded-[24px] bg-[#0D2340] p-6">

                <div className="flex items-start justify-between">

                  <div>
                    <h2 className="text-2xl font-semibold text-white">
                      Create with ETERPAX
                    </h2>

                    <p className="mt-2 text-white/70">
                      Record a personal voice message.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={
                      closeVoiceRecorder
                    }
                    className="text-white/70 hover:text-white"
                  >
                    ✕
                  </button>

                </div>

                <div className="mt-6 rounded-2xl bg-white/10 p-6 text-center">

                  <div className="text-5xl">
                    🎙️
                  </div>

                  <p className="mt-4 text-lg font-medium text-white">
                    Your voice. Your presence. Your story.
                  </p>

                  <button
                    type="button"
                    onClick={
                      handleVoiceRecording
                    }
                    className="mt-6 inline-flex items-center gap-3 rounded-full bg-[#0A7BA8] px-8 py-4 font-medium text-white"
                  >

                    <span
                      className={`h-3 w-3 rounded-full ${
                        isVoiceRecording
                          ? "animate-pulse bg-red-500"
                          : "bg-white"
                      }`}
                    />

                    {isVoiceRecording
                      ? "Stop Recording"
                      : "Start Recording"}

                  </button>

                  {recordedVoice && !removedVoice && (
  <div className="relative mt-6">
    <audio
      controls
      src={recordedVoice}
      className="w-full"
    />

    <button
      type="button"
      onClick={() => {
  if (recordedVoicePath) {
    setRemovedVoicePath(recordedVoicePath);
  }

  setRemovedVoice(true);
}}
      className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs text-white hover:bg-black"
      aria-label="Remove voice message"
    >
      ×
    </button>
  </div>
)}

                </div>

              </div>
            )}

            {/* SAVE */}

            <div className="mt-8 flex justify-end">

              <button
                type="button"
                onClick={
                  saveMessage
                }
                className="inline-flex items-center rounded-full bg-[#0A7BA8] px-8 py-4 font-medium text-white transition hover:bg-[#08698F]"
              >
                Save Recipient &
                Continue →
              </button>

            </div>

          </div>
        </div>
      )}
           {/* =====================================================
    LETTER EDITOR
===================================================== */}

{showLetterEditor && (
  <div className="fixed inset-0 z-[150]">
    {/* BACKDROP */}
    <div
      className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
      onClick={() => setShowLetterEditor(false)}
    />

    {/* MODAL */}
    <div className="absolute inset-x-4 top-1/2 mx-auto flex max-h-[92vh] max-w-4xl -translate-y-1/2 flex-col overflow-hidden rounded-[32px] bg-white shadow-2xl">
      
      {/* HEADER */}
      <div className="shrink-0 border-b border-[#E9E5DC] px-7 pb-6 pt-7 md:px-9">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium tracking-[0.28em] text-[#0A7BA8]">
              ETERPAX · LETTER
            </p>

            <h2 className="mt-2 text-4xl font-light tracking-tight text-[#0D2340]">
              Write your letter.
            </h2>

            <p className="mt-2 text-lg font-semibold leading-7 text-[#17375E]">
              There is no perfect way to say what matters. Just begin.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowLetterEditor(false)}
            className="ml-6 text-2xl font-light text-neutral-400 transition hover:text-[#0D2340]"
            aria-label="Close letter editor"
          >
            ×
          </button>
        </div>
      </div>

      {/* EDITOR */}
      <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6 md:px-9">
        <EterpaxLetterEditor
          value={message}
          onChange={setMessage}
        />
      </div>

      {/* FOOTER */}
      <div className="shrink-0 border-t border-[#E9E5DC] bg-[#FFFDF8] px-7 py-5 md:px-9">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              setLetterSaved(true);
              setShowLetterEditor(false);
            }}
            className="inline-flex items-center rounded-full bg-[#0A7BA8] px-8 py-4 font-medium text-white shadow-sm transition hover:bg-[#08698F]"
          >
            Done · Save Letter →
          </button>
        </div>
      </div>

    </div>
  </div>
)}

      {/* =====================================================
          PHOTO OPTIONS
      ===================================================== */}

      {showPhotoOptions && (
        <div className="fixed inset-0 z-[100]">

          <div
            className="absolute inset-0 bg-black/40"
            onClick={() =>
              setShowPhotoOptions(
                false
              )
            }
          />

<div className="absolute left-1/2 top-1/2 w-[calc(100%-3rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-[32px] bg-[#0F2747] py-12 px-10 shadow-2xl">

            <div className="mx-auto mb-6 h-1.5 w-16 rounded-full bg-neutral-300" />

            <p className="text-xs font-medium tracking-[0.25em] text-[#7DD3FC]">
              ETERPAX PHOTOS
            </p>

            <h2 className="mt-2 text-2xl font-semibold text-white">
              Add Photos
            </h2>

            <p className="mt-2 text-neutral-500">
              How would you like to add your photos?
            </p>
            console.log("EXISTING PHOTOS:", signedPhotos);
            {existingPhotoUrls.length > 0 && (
  <div className="mt-6">
    <p className="mb-3 text-sm font-medium text-white">
      Photos already added
    </p>

    <div className="grid grid-cols-3 gap-3">
    {existingPhotoUrls.map((url, index) => (
  <div
    key={`${url}-${index}`}
    className="relative overflow-hidden rounded-xl border border-white/20"
  >
    <img
      src={url}
      alt={`Saved photo ${index + 1}`}
      className="h-24 w-full object-cover"
    />

    <button
      type="button"
      onClick={() => {
        const pathToRemove = existingPhotoPaths[index];
      
        if (pathToRemove) {
          setRemovedPhotoPaths((current) => [...current, pathToRemove]);
        }
      
        setExistingPhotoUrls((current) =>
          current.filter((_, photoIndex) => photoIndex !== index)
        );
      
        setExistingPhotoPaths((current) =>
          current.filter((_, photoIndex) => photoIndex !== index)
        );
      }}
      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs text-white hover:bg-black"
      aria-label={`Remove saved photo ${index + 1}`}
    >
      ×
    </button>
  </div>
))}
    </div>
  </div>
)}
            <div className="mt-8 space-y-3">

              <button
                type="button"
                onClick={() => {
                  setShowPhotoOptions(
                    false
                  );

                  setShowPhotoCamera(
                    true
                  );
                }}
                className="flex w-full items-center justify-between rounded-2xl border border-[#D9E4F2] p-5 text-left hover:border-[#0A7BA8] hover:bg-[#0A7BA8]/5"
              >

                <div className="flex items-center gap-4">

                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#0F5C88]/10 text-xl">
                    📷
                  </div>

                  <div>
                    <p className="font-medium text-white">
                      Take with ETERPAX
                    </p>

                    <p className="mt-1 text-sm text-white/60">
                      Use your camera to take photos.
                    </p>
                  </div>

                </div>

                <span className="text-xl text-[#0A7BA8]">
                  →
                </span>

              </button>

              <button
                type="button"
                onClick={() => {
                  setShowPhotoOptions(
                    false
                  );

                  document
                    .getElementById(
                      "photo-upload"
                    )
                    ?.click();
                }}
                className="flex w-full items-center justify-between rounded-2xl border border-[#D9E4F2] p-5 text-left hover:border-[#0A7BA8] hover:bg-[#0A7BA8]/5"
              >

                <div className="flex items-center gap-4">

                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#0F5C88]/10 text-xl">
                    🖼️
                  </div>

                  <div>
                    <p className="font-medium text-white">
                    Choose from your device
                    </p>

                    <p className="mt-1 text-sm text-white/60">
                    Select the photos you want to preserve.
                    </p>
                  </div>

                </div>

                <span className="text-xl text-[#0A7BA8]">
                  →
                </span>

              </button>

            </div>

          </div>
        </div>
      )}

      {/* =====================================================
          PHOTO CAMERA
      ===================================================== */}

{showPhotoCamera && (
  <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-6">
    <div className="relative flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-[24px] bg-[#0D2340] shadow-2xl">

      <div className="flex items-start justify-between p-6">
        <div>
          <p className="text-xs font-medium tracking-[0.25em] text-white/70">
            ETERPAX CAMERA
          </p>
          <h2 className="mt-1 text-xl font-medium text-white">
            Take Photos
          </h2>
        </div>

        <button
          type="button"
          onClick={finishPhotoCamera}
          className="rounded-full bg-black/40 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm"
        >
          Done
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-black">
        <video
          ref={photoVideoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
        />
      </div>

      <div className="absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/90 to-transparent px-6 pb-10 pt-20">
        <div className="flex flex-col items-center">
          <p className="mb-5 text-sm text-white/80">
            {photoFiles.length > 0
              ? `${photoFiles.length} photo${
                  photoFiles.length === 1 ? "" : "s"
                } selected`
              : "Take a photo with ETERPAX"}
          </p>

          <button
            type="button"
            onClick={takePhoto}
            className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-white/20 shadow-2xl transition hover:scale-105"
          >
            <span className="h-14 w-14 rounded-full bg-white" />
          </button>
        </div>
      </div>

    </div>
  </div>
)}

      {/* =====================================================
          HIDDEN FILE INPUTS
      ===================================================== */}

      <input
        id="document-upload"
        type="file"
        accept=".pdf,.doc,.docx,.txt,.xls,.xlsx,.ppt,.pptx"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
setDocumentFiles((previousFiles) => [...previousFiles, ...files]);
setDocumentFile((previousFile) => previousFile ?? files[0] ?? null);
event.target.value = "";
        }}
      />

      <input
        id="photo-upload"
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={
          handlePhotoUpload
        }
      />

    </OnboardingFormLayout>
  );
}
