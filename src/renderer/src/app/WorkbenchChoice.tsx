import { Dropdown, Option } from './SharedDropdown'
import { Field } from '@fluentui/react-components'

export function WorkbenchChoice<T extends string>({
  label,
  values,
  value,
  text,
  onChange,
}: {
  label: string
  values: readonly T[]
  value: T
  text: (key: T) => string
  onChange: (key: T) => void
}) {
  return (
    <Field label={label}>
      <Dropdown
        value={text(value)}
        selectedOptions={[value]}
        onOptionSelect={(_, data) => {
          const choice = values.find((item) => item === data.optionValue)
          if (choice !== undefined) onChange(choice)
        }}
      >
        {values.map((item) => (
          <Option key={item} value={item}>
            {text(item)}
          </Option>
        ))}
      </Dropdown>
    </Field>
  )
}
