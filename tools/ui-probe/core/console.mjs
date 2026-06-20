export function collectConsoleProblems(page) {
  const consoleProblems = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !isBenignConsoleProblem(message.text())) {
      consoleProblems.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleProblems.push(error.message);
  });
  return consoleProblems;
}

export function isBenignConsoleProblem(message) {
  return (
    message === "Failed to load resource: the server responded with a status of 404 (Not Found)" ||
    message === "Failed to load resource: net::ERR_INCOMPLETE_CHUNKED_ENCODING"
  );
}
