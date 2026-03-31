/* ========================================
   Global type declarations for frontend
   External libraries + browser API augments + not-yet-converted files
   ======================================== */

// --- Quill rich text editor (loaded via CDN) ---
declare var Quill: any;

// --- Google Sign-In ---
declare namespace google {
  namespace accounts {
    namespace id {
      function initialize(config: { client_id: string; callback: (response: { credential: string }) => void }): void;
      function prompt(): void;
      function renderButton(parent: HTMLElement, options: any): void;
    }
  }
}

// --- html2canvas ---
declare var html2canvas: any;

// All frontend files are now TypeScript — no more JS-only declarations needed.
