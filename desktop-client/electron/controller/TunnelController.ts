import Logger from "../core/Logger";
import WireGuardTunnelService from "../service/WireGuardTunnelService";
import ResponseUtils from "../utils/ResponseUtils";
import BaseController from "./BaseController";

class TunnelController extends BaseController {
  private readonly _tunnelService: WireGuardTunnelService;

  constructor(tunnelService: WireGuardTunnelService) {
    super();
    this._tunnelService = tunnelService;
  }

  start(req: ControllerParam) {
    this._tunnelService
      .startTunnel()
      .then(() => {
        req.event.reply(req.channel, ResponseUtils.success());
      })
      .catch((err: Error) => {
        Logger.error("TunnelController.start", err);
        req.event.reply(req.channel, ResponseUtils.fail(err));
      });
  }

  stop(req: ControllerParam) {
    this._tunnelService
      .stopTunnel()
      .then(() => {
        req.event.reply(req.channel, ResponseUtils.success());
      })
      .catch((err: Error) => {
        Logger.error("TunnelController.stop", err);
        req.event.reply(req.channel, ResponseUtils.fail(err));
      });
  }

  refresh(req: ControllerParam) {
    this._tunnelService
      .refreshTunnel()
      .then(() => this._tunnelService.getStatus())
      .then(status => {
        req.event.reply(req.channel, ResponseUtils.success(status));
      })
      .catch((err: Error) => {
        Logger.error("TunnelController.refresh", err);
        req.event.reply(req.channel, ResponseUtils.fail(err));
      });
  }

  getStatus(req: ControllerParam) {
    this._tunnelService
      .getStatus()
      .then(status => {
        req.event.reply(req.channel, ResponseUtils.success(status));
      })
      .catch((err: Error) => {
        Logger.error("TunnelController.getStatus", err);
        req.event.reply(req.channel, ResponseUtils.fail(err));
      });
  }
}

export default TunnelController;
