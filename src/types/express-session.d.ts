import 'express-session';
import 'express-serve-static-core';

declare module 'express-session' {
  interface SessionData {
    admin?: boolean;
    email?: string;
    name?: string;
  }
}

// Override Express 5 params — validateId middleware ensures id is always a string
declare module 'express-serve-static-core' {
  interface ParamsDictionary {
    id: string;
  }
}
