import { EyeOutlined, NodeIndexOutlined, TableOutlined } from "@ant-design/icons";
import { Typography } from "antd";

const { Text } = Typography;

export type StudioTrainingConceptBannerProps = {
  compact?: boolean;
};

export function StudioTrainingConceptBanner({ compact }: StudioTrainingConceptBannerProps) {
  return (
    <div
      className={["studio-training-concept", compact ? "studio-training-concept--compact" : ""].filter(Boolean).join(" ")}
      id="studio-training-concept"
    >
      <div className="studio-training-concept__intro">
        <Text strong className="studio-training-concept__lead">
          Модель не «запоминает» таблицу как конспект.
        </Text>
        {!compact ? (
          <Text type="secondary" className="studio-training-concept__sub">
            Обучение — это долгая подстройка правила по ошибкам: по столбцам ищется закономерность «если признаки такие → ответ такой», чтобы на похожих новых строках тоже попадать.
          </Text>
        ) : (
          <Text type="secondary" className="studio-training-concept__sub">
            Подстройка правила по ошибкам, а не зубрёжка строк.
          </Text>
        )}
      </div>

      <div className="studio-training-concept__grid">
        <div className="studio-training-concept__item">
          <TableOutlined className="studio-training-concept__icon" aria-hidden />
          <Text strong className="studio-training-concept__item-title">
            Закономерность
          </Text>
          <Text type="secondary" className="studio-training-concept__item-body">
            {compact
              ? "Ищется связь признаков с ответом, а не каждая строка наизусть."
              : "Из многих примеров модель выводит общее правило: как числа и категории в строке связаны с целевым столбцом."}
          </Text>
        </div>

        <div className="studio-training-concept__item">
          <NodeIndexOutlined className="studio-training-concept__icon" aria-hidden />
          <Text strong className="studio-training-concept__item-title">
            Ошибка ведёт обучение
          </Text>
          <Text type="secondary" className="studio-training-concept__item-body">
            {compact
              ? "Loss — насколько ответ модели далёк от правды; его обычно уменьшают по эпохам."
              : "Число loss — мера промаха. Оптимизатор многократно меняет «ручки» модели (веса), чтобы ответы всё чаще совпадали с правильными на учебной части данных."}
          </Text>
        </div>

        <div className="studio-training-concept__item">
          <EyeOutlined className="studio-training-concept__icon" aria-hidden />
          <Text strong className="studio-training-concept__item-title">
            Учёба и контроль
          </Text>
          <Text type="secondary" className="studio-training-concept__item-body">
            {compact
              ? "Синяя линия — учебная выборка; зелёная — отложенная проверка без подстройки под неё."
              : "Две кривые ниже: обучение идёт по одной части строк (синяя линия). Зелёная — та же метрика на отложенных строках: так проверяют, что правило не только «натренировали под конкретные примеры»."}
          </Text>
        </div>
      </div>
    </div>
  );
}
