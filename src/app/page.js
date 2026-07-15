"use client";

import { useSession, signIn, signOut } from "next-auth/react";

export default function Home() {
  const { data: session } = useSession();

  return (
    <main style={{ padding: "2rem", textAlign: "center" }}>
      <h1>YouTube Studio</h1>
      {session ? (
        <div>
          <p>سلام {session.user.name} 👋</p>
          <img
            src={session.user.image}
            alt="profile"
            style={{ borderRadius: "50%", width: "80px" }}
          />
          <br />
          <button onClick={() => signOut()}>خروج</button>
        </div>
      ) : (
        <button onClick={() => signIn("google")}>ورود با گوگل</button>
      )}
    </main>
  );
}
