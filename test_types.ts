import { Request, Response } from 'express';
const r: Request = {} as any;
r.body;
r.params;
r.query;
const s: Response = {} as any;
s.statusCode;
s.setHeader;
s.end;
