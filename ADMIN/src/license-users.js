function cleanUserValue(value) {
  return String(value ?? "").trim();
}

export function hasUserContent(user) {
  return Boolean(
    user?.memberId
    || user?.activeDevice
    || cleanUserValue(user?.name)
    || cleanUserValue(user?.email)
    || user?.isManager
  );
}

export function resizeUsersForSeatInput(users, rawSeatCount, createEmptyUser) {
  const currentUsers = Array.isArray(users) ? users : [];
  const parsedSeatCount = Number(rawSeatCount);
  const requestedCount = Number.isInteger(parsedSeatCount) && parsedSeatCount >= 1
    ? parsedSeatCount
    : currentUsers.length;

  let protectedCount = 0;
  currentUsers.forEach((user, index) => {
    if (hasUserContent(user)) protectedCount = index + 1;
  });

  const targetCount = Math.max(1, requestedCount, protectedCount);
  const nextUsers = currentUsers.slice(0, targetCount);
  while (nextUsers.length < targetCount) {
    nextUsers.push(createEmptyUser());
  }

  return nextUsers;
}
