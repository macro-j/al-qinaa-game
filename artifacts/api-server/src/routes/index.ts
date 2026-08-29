import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tapRouter from "./tap";
import accountRouter from "./account";
import distributionHistoryRouter from "./distributionHistory";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tapRouter);
router.use(accountRouter);
router.use(distributionHistoryRouter);

export default router;
