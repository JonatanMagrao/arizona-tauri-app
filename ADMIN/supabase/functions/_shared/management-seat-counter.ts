import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.8";
import type { MasterActor, MemberActor } from "./actors.ts";

type SeatMember = {
  id: string;
  email: string;
  role: string;
  status: string;
};

type ManagementSeatCounterInput = {
  actor: MasterActor | MemberActor;
  members: SeatMember[];
  seatsAllowed: number;
  consumedSeats: number;
};

// Presentation only: the organization and its seat-limit trigger keep their
// real totals. Removing the manager from BOTH counters preserves availability
// in existing app versions, which calculate it as seatsAllowed - consumedSeats.
export async function managementSeatCounter(
  admin: SupabaseClient,
  { actor, members, seatsAllowed, consumedSeats }: ManagementSeatCounterInput,
) {
  if (![seatsAllowed, consumedSeats].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error("invalid_management_seat_count");
  }

  const manager = actor.kind === "member" && actor.role === "admin"
    ? members.find((member) => member.id === actor.id && member.role === "admin"
      && ["invited", "active"].includes(member.status))
    : undefined;

  let ownSeat = 0;
  if (manager && seatsAllowed > 0 && consumedSeats > 0) {
    // A master signed into the app can resolve as a member. Reuse the exact
    // SQL exemption used by consumed_seats rather than relying on actor.kind.
    const { data: alreadyExempt, error } = await admin
      .schema("licensing")
      .rpc("is_active_master_email", { email_value: manager.email });
    if (error) throw error;
    if (typeof alreadyExempt !== "boolean") throw new Error("invalid_master_seat_exemption");
    if (!alreadyExempt) ownSeat = 1;
  }

  return {
    seatsAllowed: seatsAllowed - ownSeat,
    consumedSeats: consumedSeats - ownSeat,
    availableSeats: Math.max(0, seatsAllowed - consumedSeats),
  };
}
