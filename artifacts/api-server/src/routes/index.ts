import { Router, type IRouter } from "express";
import healthRouter from "./health";
import stripeRouter from "./stripe";
import accountRouter from "./account";

const router: IRouter = Router();

router.use(healthRouter);
router.use(stripeRouter);
router.use(accountRouter);

export default router;
