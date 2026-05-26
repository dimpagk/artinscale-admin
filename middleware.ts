import { NextRequest, NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { createClient } from '@supabase/supabase-js';

export async function middleware(request: NextRequest) {
  const { user, supabaseResponse } = await updateSession(request);

  const isLoginPage = request.nextUrl.pathname === '/login';

  // Not authenticated — redirect to login
  if (!user) {
    if (isLoginPage) return supabaseResponse;
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Check admin role using service role client (bypasses RLS)
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: userData } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('email', user.email)
    .single();

  const isAdmin = userData?.role === 'ADMIN';

  if (!isAdmin) {
    if (isLoginPage) return supabaseResponse;
    // Not an admin — redirect to login with error
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('error', 'unauthorized');
    return NextResponse.redirect(loginUrl);
  }

  // Admin is authenticated — redirect away from login
  if (isLoginPage) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return supabaseResponse;
}

export const config = {
  // Exclude:
  //   _next/static, _next/image, favicon.ico — Next.js asset paths
  //   auth/callback                          — Supabase OAuth completion
  //   api/cron/                              — Vercel Cron / external schedulers
  //                                            (gated by x-vercel-cron-signature
  //                                            or AGENT_TRIGGER_TOKEN inside the route)
  //   api/agents/run/                        — cross-app agent triggers
  //                                            (gated by AGENT_TRIGGER_TOKEN)
  //   api/email/send-approved                — same Bearer-gated trigger pattern
  //   api/external/                          — cross-app on-demand print pipeline
  //                                            (gated by AGENT_TRIGGER_TOKEN
  //                                            inside the route)
  //
  // Everything else (including the rest of /api/*) requires an admin
  // session via the supabase middleware.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|auth/callback|api/cron/|api/agents/run/|api/email/send-approved|api/external/).*)',
  ],
};
