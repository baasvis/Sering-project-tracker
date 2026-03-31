import 'express-session';
import 'express';

declare module 'express-session' {
  interface SessionData {
    admin?: boolean;
    email?: string;
    name?: string;
  }
}

// Make req.params.id always string (validated by middleware)
declare module 'express' {
  interface ParamsDictionary {
    [key: string]: string;
  }
}
