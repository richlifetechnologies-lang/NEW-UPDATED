import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import sessionsRouter from "./sessions";
import paymentsRouter from "./payments";
import pricingRouter from "./pricing";
import decartRouter from "./decart";
import adminRouter from "./admin";
import adminNotificationsRouter from "./admin-notifications";
import adminMonitoringRouter from "./admin-monitoring";
import downloadRouter from "./download";
import ratesRouter from "./rates";
import chatRouter from "./chat";
import subAdminRouter from "./sub-admin";
import licenseRouter from "./license";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/rates", ratesRouter);
router.use("/chat", chatRouter);
router.use("/auth", authRouter);
router.use("/users", usersRouter);
router.use("/sessions", sessionsRouter);
router.use("/payments", paymentsRouter);
router.use("/pricing", pricingRouter);
router.use("/decart", decartRouter);
router.use("/admin", adminRouter);
router.use("/admin/notifications", adminNotificationsRouter);
router.use("/admin/api-monitoring", adminMonitoringRouter);
router.use(downloadRouter);
router.use("/subadmin", subAdminRouter);
router.use("/license", licenseRouter);

export default router;
