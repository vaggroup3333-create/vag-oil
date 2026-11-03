import {env} from 'cloudflare:workers';
import {authenticate} from '../../../lib/password-auth';
export const dynamic='force-dynamic';
export async function GET(req:Request){return authenticate(req,env)}
export async function POST(req:Request){return authenticate(req,env)}
