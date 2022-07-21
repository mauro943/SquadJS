import BasePlugin from './base-plugin.js';

const VALID_KITS = new Set([
  /* Aussies */
  'AUS_SL_01',
  'AUS_SL_02',
  'AUS_SL_03',
  'AUS_SLCrewman_01',
  'AUS_Crewman_01',
  'AUS_SLPilot_01',
  'AUS_Pilot_01',

  /* Canadians */
  'CAF_SL_01',
  'CAF_SL_02',
  'CAF_SL_03',
  'CAF_SLCrewman_01',
  'CAF_Crewman_01',
  'CAF_SLPilot_01',
  'CAF_Pilot_01',

  /* British */
  'GB_SL_01',
  'GB_SL_02',
  'GB_SL_03',
  'GB_SLCrewman_01',
  'GB_Crewman_01',
  'GB_SLPilot_01',
  'GB_Pilot_01',

  /* Insurgents */
  'INS_SL_01',
  'INS_SL_02',
  'INS_SL_03',
  'INS_SLCrewman_01',
  'INS_Crewman_01',

  /* MEA */
  'MEA_SL_01',
  'MEA_SL_02',
  'MEA_SL_03',
  'MEA_SLCrewman_01',
  'MEA_Crewman_01',
  'MEA_SLPilot_01',
  'MEA_Pilot_01',

  /* Militia */
  'MIL_SL_01',
  'MIL_SL_02',
  'MIL_SL_03',
  'MIL_SLCrewman_01',
  'MIL_Crewman_01',

  /* Russians */
  'RUS_SL_01',
  'RUS_SL_02',
  'RUS_SL_03',
  'RUS_SLCrewman_01',
  'RUS_Crewman_01',
  'RUS_SLPilot_01',
  'RUS_Pilot_01',

  /* Muricans */
  'USA_SL_01',
  'USA_SL_02',
  'USA_SL_03',
  'USA_SLCrewman_01',
  'USA_Crewman_01',
  'USA_SLPilot_01',
  'USA_Pilot_01',

  /* Marines */
  'USMC_SL_01',
  'USMC_SL_02',
  'USMC_SL_03',
  'USMC_SLCrewman_01',
  'USMC_Crewman_01',
  'USMC_SLPilot_01',
  'USMC_Pilot_01',
]);

export default class AutoSLKitCheck extends BasePlugin {
  static get description() {
    return 'The <code>AutoSLKitCheck</code> plugin warns squad leaders to use SL kits.' +
      'Optionally disbands the squad after a specified ammount of time.';
  }

  static get defaultEnabled() {
    return false;
  }

  static get optionsSpecification() {
    return {
      warningMessage: {
        required: false,
        description: 'Warning message SquadJS will send to squad leaders',
        default: 'You must use a squad leader kit'
      },
      disbandMessage: {
        required: false,
        description: 'Message to send after disbanding the squad',
        default: 'Squad disbanded due to invalid squad leader kit'
      },
      frequency: {
        required: false,
        description: 'Delay in <b>Seconds</b> to check for kits.',
        default: 30
      },
      maxWarnings: {
        required: false,
        description: 'Number of warnings to broadcast before disbanding the squad',
        default: 3
      },
      roundStartDelay: {
        required: false,
        description:
          'Time delay in <b>Seconds</b> from start of the round before AutoSLKitCheck starts running',
        default: 3 * 60
      },
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);

    this.betweenRounds = false;
    this.roundStartDelay = options.roundStartDelay * 1000;
    this.frequency = options.frequency * 1000;
    this.maxWarnings = options.maxWarnings;
    this.trackedPlayers = {};
    this.squadsToDisband = new Set();

    this.updateTrackingList = this.updateTrackingList.bind(this);
    this.disbandSquads = this.disbandSquads.bind(this);
    this.trackPlayer = this.trackPlayer.bind(this);
    this.untrackPlayer = this.untrackPlayer.bind(this);
  }

  async mount() {
    this.server.on('NEW_GAME', this.onNewGame);
    this.checkInterval = setInterval(this.updateTrackingList, this.frequency);
    this.disbandInterval = setInterval(this.disbandSquads, this.frequency);
  }

  async unmount() {
    this.server.removeEventListener('NEW_GAME', this.onNewGame);
    clearInterval(this.checkInterval);
    clearInterval(this.disbandInterval);
  }

  async onNewGame() {
    this.betweenRounds = true;
    setTimeout(() => {
      this.betweenRounds = false;
    }, this.roundStartDelay);
  }

  async updateTrackingList() {
    if (this.betweenRounds) return;

    await this.server.updatePlayerList(true);

    for (const player of this.server.players) {
      const isTracked = player.steamID in this.trackedPlayers || this.squadsToDisband.has(player.steamID);
      const invalidKit = player.isLeader && !VALID_KITS.has(player.role);

      if (!invalidKit) {
        if (isTracked) this.untrackPlayer(player.steamID);
        continue;
      }

      if (!isTracked) this.trackedPlayers[player.steamID] = this.trackPlayer(player);
    }
  }

  trackPlayer(player) {
    this.verbose(2, `Tracking SL: ${player.name}`);

    const tracker = {
      player,
      warnings: 0,
      startTime: Date.now()
    };

    tracker.timerID = setInterval(async () => {
      tracker.warnings++;
      if (tracker.warnings >= this.maxWarnings) {
        this.squadsToDisband.add(tracker.player.steamID);
      }
      if (tracker.warnings > this.maxWarnings) {
        clearInterval(tracker.timerID);
        return;
      }

      const warningsText = this.maxWarnings ? ` (${tracker.warnings} / ${this.maxWarnings})` : '';
      this.server.rcon.warn(tracker.player.steamID, `${this.options.warningMessage}${warningsText}`);
      this.verbose(2, `SL kit warning: ${tracker.player.name}${warningsText}`);

    }, this.frequency);

    return tracker;
  }

  untrackPlayer(steamID) {
    const tracker = this.trackedPlayers[steamID];
    clearInterval(tracker.timerID);
    delete this.trackedPlayers[steamID];
    this.verbose(2, `unTrack squad leader: ${tracker.player.name}`);
  }

  async disbandSquads() {
    if (this.betweenRounds || !this.squadsToDisband.size) return;
    await this.updateTrackingList();
    for (const steamID of this.squadsToDisband) {
      if (!(steamID in this.trackedPlayers)) return;
      const tracker = this.trackedPlayers[steamID];
      this.untrackPlayer(tracker.player.steamID);

      this.server.rcon.disbandSquad(tracker.player.teamID, tracker.player.squadID);
      this.server.rcon.warn(tracker.player.steamID, this.options.disbandMessage);
      this.server.emit('SQUAD_AUTO_DISBANDED', {
        player: tracker.player,
        warnings: tracker.warnings,
        startTime: tracker.startTime
      });
      this.verbose(1, `Disbanded squad: ${tracker.player.squadID} in team: ${tracker.player.teamID}`);
    }
    this.squadsToDisband.clear();
  }
}
