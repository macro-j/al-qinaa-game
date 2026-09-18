import { Router, type IRouter } from "express";
import healthRouter from "./health";
import paylinkRouter from "./paylink";
import accountRouter from "./account";
import distributionHistoryRouter from "./distributionHistory";

const router: IRouter = Router();

router.use(healthRouter);
router.use(paylinkRouter);
router.use(accountRouter);
router.use(distributionHistoryRouter);

export default router;
