(function () {
  var smokeRoot = $.getenv("ARIZONA_SMOKE_ROOT");
  if (!smokeRoot) {
    return;
  }

  var commandId = 0;
  var executed = false;
  var error = "";
  try {
    commandId = app.findMenuCommandId("Arizona - Carrefour");
    if (commandId > 0) {
      app.executeCommand(commandId);
      executed = true;
    }
  } catch (exception) {
    error = String(exception).replace(/[\r\n]+/g, " ");
  }

  var proof = new File(smokeRoot + "/ae-menu-proof.txt");
  proof.encoding = "UTF-8";
  if (proof.open("w")) {
    proof.writeln("commandId=" + commandId);
    proof.writeln("executed=" + executed);
    proof.writeln("error=" + error);
    proof.close();
  }
})();
