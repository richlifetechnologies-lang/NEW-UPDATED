import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sessionsRouter from "./sessions";
import pricingRouter from "./pricing";
import decartRouter from "./decart";
import adminRouter from "./admin";
import adminNotificationsRouter from "./admin-notifications";
import adminMonitoringRouter from "./admin-monitoring";
import downloadRouter from "./download";
import chatRouter from "./chat";
import subAdminRouter from "./sub-admin";
import licenseRouter from "./license";
import billingIntelligenceRouter from "./admin-billing-intelligence";
const router: IRouter = Router();

router.use(healthRouter);
router.use("/chat", chatRouter);
router.use("/sessions", sessionsRouter);
router.use("/pricing", pricingRouter);
router.use("/decart", decartRouter);
router.use("/admin", adminRouter);
router.use("/admin/notifications", adminNotificationsRouter);
router.use("/admin/api-monitoring", adminMonitoringRouter);
router.use("/admin/billing-intelligence", billingIntelligenceRouter);
router.use(downloadRouter);
router.use("/subadmin", subAdminRouter);
router.use("/license", licenseRouter);

export default router;
