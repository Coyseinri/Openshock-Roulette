// Preserve the private player info details state across panel refreshes.
// The panel HTML is rebuilt often, so a normal <details> would snap shut again.

const osrLoadPlayerObjectivePanel = loadPlayerObjectivePanel;

loadPlayerObjectivePanel = async function loadPlayerObjectivePanelWithPrivateState() {
  const panel = document.getElementById("objectivePanelBody");
  const wasOpen = Boolean(panel?.querySelector(".privatePlayerInfoDetails")?.open);

  await osrLoadPlayerObjectivePanel();

  if (wasOpen) {
    const details = document.querySelector("#objectivePanelBody .privatePlayerInfoDetails");
    if (details) details.open = true;
  }
};
